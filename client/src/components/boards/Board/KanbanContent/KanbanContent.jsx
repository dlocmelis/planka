/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { DragDropContext, Droppable } from 'react-beautiful-dnd';
import { useDidUpdate } from '../../../../lib/hooks';
import { closePopup } from '../../../../lib/popup';

import selectors from '../../../../selectors';
import entryActions from '../../../../entry-actions';
import { CardDragContext } from '../../../../contexts';
import parseDndId, { isCardDndId } from '../../../../utils/parse-dnd-id';
import DroppableTypes from '../../../../constants/DroppableTypes';
import { BoardMembershipRoles } from '../../../../constants/Enums';
import AddList from './AddList';
import BulkActionsBar from '../../../cards/BulkActionsBar';
import List from '../../../lists/List';
import PlusMathIcon from '../../../../assets/images/plus-math-icon.svg?react';

import styles from './KanbanContent.module.scss';
import globalStyles from '../../../../styles.module.scss';

const KanbanContent = React.memo(() => {
  const listIds = useSelector(selectors.selectKanbanListIdsForCurrentBoard);
  const selectedCardIds = useSelector(selectors.selectSelectedCardIds);

  const canAddList = useSelector((state) => {
    const isEditModeEnabled = selectors.selectIsEditModeEnabled(state); // TODO: move out?

    if (!isEditModeEnabled) {
      return isEditModeEnabled;
    }

    const boardMembership = selectors.selectCurrentUserMembershipForCurrentBoard(state);
    return !!boardMembership && boardMembership.role === BoardMembershipRoles.EDITOR;
  });

  const dispatch = useDispatch();
  const [t] = useTranslation();
  const [isAddListOpened, setIsAddListOpened] = useState(false);
  const [isCardDragActive, setIsCardDragActive] = useState(false);
  const [draggingCardId, setDraggingCardId] = useState(null);

  const wrapperRef = useRef(null);
  const prevPositionRef = useRef(null);

  const handleBeforeCapture = useCallback(({ draggableId }) => {
    if (!isCardDndId(draggableId)) {
      return;
    }

    // Must be applied synchronously so every list freezes (latches) its collapsed/expanded
    // state before react-beautiful-dnd captures Droppable dimensions
    ReactDOM.flushSync(() => {
      setIsCardDragActive(true);
      setDraggingCardId(parseDndId(draggableId));
    });
  }, []);

  const handleDragStart = useCallback(() => {
    document.body.classList.add(globalStyles.dragging);
    closePopup();
  }, []);

  const handleDragEnd = useCallback(
    ({ draggableId, type, source, destination }) => {
      document.body.classList.remove(globalStyles.dragging);
      setDraggingCardId(null);

      if (!destination) {
        setIsCardDragActive(false);
        return;
      }

      const id = parseDndId(draggableId);

      // Dragging a selected card carries the whole selection along; dragging any other card
      // moves just that one and leaves the selection alone
      const isGroupMove =
        type === DroppableTypes.CARD && selectedCardIds.length > 1 && selectedCardIds.includes(id);

      // A group dropped back where it was still gathers the other selected cards there
      if (
        !isGroupMove &&
        source.droppableId === destination.droppableId &&
        source.index === destination.index
      ) {
        setIsCardDragActive(false);
        return;
      }

      switch (type) {
        case DroppableTypes.LIST:
          dispatch(entryActions.moveList(id, destination.index));

          break;
        case DroppableTypes.CARD:
          if (isGroupMove) {
            dispatch(
              entryActions.moveCards(
                selectedCardIds,
                parseDndId(destination.droppableId),
                destination.index,
                id,
              ),
            );

            dispatch(entryActions.clearCardSelection());
          } else {
            dispatch(
              entryActions.moveCard(id, parseDndId(destination.droppableId), destination.index),
            );
          }

          break;
        default:
      }

      setIsCardDragActive(false);
    },
    [selectedCardIds, dispatch],
  );

  const handleAddListClick = useCallback(() => {
    setIsAddListOpened(true);
  }, []);

  const handleAddListClose = useCallback(() => {
    setIsAddListOpened(false);
  }, []);

  const handleMouseDown = useCallback((event) => {
    // If button is defined and not equal to 0 (left click)
    if (event.button) {
      return;
    }

    if (event.target !== wrapperRef.current && !event.target.dataset.dragScroller) {
      return;
    }

    prevPositionRef.current = event.clientX;

    window.getSelection().removeAllRanges();
    document.body.classList.add(globalStyles.dragScrolling);
  }, []);

  const handleWindowMouseMove = useCallback((event) => {
    if (prevPositionRef.current === null) {
      return;
    }

    event.preventDefault();

    window.scrollBy({
      left: prevPositionRef.current - event.clientX,
    });

    prevPositionRef.current = event.clientX;
  }, []);

  const handleWindowMouseRelease = useCallback(() => {
    if (prevPositionRef.current === null) {
      return;
    }

    prevPositionRef.current = null;
    document.body.classList.remove(globalStyles.dragScrolling);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleWindowMouseMove);

    window.addEventListener('mouseup', handleWindowMouseRelease);
    window.addEventListener('blur', handleWindowMouseRelease);
    window.addEventListener('contextmenu', handleWindowMouseRelease);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);

      window.removeEventListener('mouseup', handleWindowMouseRelease);
      window.removeEventListener('blur', handleWindowMouseRelease);
      window.removeEventListener('contextmenu', handleWindowMouseRelease);
    };
  }, [handleWindowMouseMove, handleWindowMouseRelease]);

  useEffect(
    () => () => {
      dispatch(entryActions.clearCardSelection());
    },
    [dispatch],
  );

  const groupSize =
    draggingCardId && selectedCardIds.length > 1 && selectedCardIds.includes(draggingCardId)
      ? selectedCardIds.length
      : 0;

  // Keyed on primitives, not on the selector's array: that array is rebuilt on every Card or
  // List change (socket updates included), which would re-render every DraggableCard
  const cardDragContextValue = useMemo(
    () => ({
      draggingCardId,
      groupSize,
    }),
    [draggingCardId, groupSize],
  );

  useDidUpdate(() => {
    if (isAddListOpened) {
      window.scroll(document.body.scrollWidth, 0);
    }
  }, [listIds, isAddListOpened]);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div ref={wrapperRef} className={styles.wrapper} onMouseDown={handleMouseDown}>
      <div>
        <DragDropContext
          onBeforeCapture={handleBeforeCapture}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <CardDragContext.Provider value={cardDragContextValue}>
            <Droppable droppableId="board" type={DroppableTypes.LIST} direction="horizontal">
              {({ innerRef, droppableProps, placeholder }) => (
                <div
                  {...droppableProps} // eslint-disable-line react/jsx-props-no-spreading
                  data-drag-scroller
                  ref={innerRef}
                  className={styles.lists}
                >
                  {listIds.map((listId, index) => (
                    <List key={listId} id={listId} index={index} isDragActive={isCardDragActive} />
                  ))}
                  {placeholder}
                  {canAddList && (
                    <div data-drag-scroller className={styles.list}>
                      {isAddListOpened ? (
                        <AddList onClose={handleAddListClose} />
                      ) : (
                        <button
                          type="button"
                          className={styles.addListButton}
                          onClick={handleAddListClick}
                        >
                          <PlusMathIcon className={styles.addListButtonIcon} />
                          <span className={styles.addListButtonText}>
                            {listIds.length > 0 ? t('action.addAnotherList') : t('action.addList')}
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Droppable>
          </CardDragContext.Provider>
        </DragDropContext>
      </div>
      <BulkActionsBar />
    </div>
  );
});

export default KanbanContent;
