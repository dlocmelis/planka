/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { DragDropContext, Draggable, Droppable } from 'react-beautiful-dnd';
import { Icon, Label } from 'semantic-ui-react';
import { usePopup } from '../../../lib/popup';

import {
  RaiseOutcomes,
  RaiseRefusals,
  dropTargetIndex,
  formatDuration,
  isLockedJob,
  previewRaise,
  topTargetIndex,
  upTargetIndex,
} from '../../../utils/pipeline-strip';
import MoveStep from './MoveStep';

import styles from './PipelineStrip.module.scss';
import globalStyles from '../../../styles.module.scss';

const DROPPABLE_ID = 'pipeline-queue';

// What a preview says, as one short line.
const previewText = (t, preview) => {
  if (!preview.allowed) {
    return t(
      preview.refusal === RaiseRefusals.LOCKED
        ? 'pipeline.cannotPassLocked'
        : 'pipeline.onlyUpward',
    );
  }

  if (preview.outcome === RaiseOutcomes.CEILING) {
    return t('pipeline.alreadyAtCeiling', { level: preview.from });
  }

  return t(preview.tie ? 'pipeline.willApplyTie' : 'pipeline.willApply', {
    level: preview.to,
  });
};

const QueueItem = React.memo(
  ({
    item,
    index,
    queue,
    canEdit,
    dragHint,
    secondsWaited,
    durationUnits,
    onOpenCard,
    onRaise,
  }) => {
    const [t] = useTranslation();

    const locked = isLockedJob(item);
    const upIndex = canEdit && !locked ? upTargetIndex(queue, index) : -1;
    const topIndex = canEdit && !locked ? topTargetIndex(queue, index) : -1;

    const handleNameClick = useCallback(() => {
      onOpenCard(item.cardId);
    }, [item.cardId, onOpenCard]);

    const handleMoveUpClick = useCallback(() => {
      onRaise(index, upIndex, queue);
    }, [index, upIndex, queue, onRaise]);

    const handleToTopClick = useCallback(() => {
      onRaise(index, topIndex, queue);
    }, [index, topIndex, queue, onRaise]);

    const MovePopup = usePopup(MoveStep);

    return (
      <Draggable
        draggableId={item.jobId}
        index={index}
        isDragDisabled={!canEdit || locked || index === 0}
      >
        {({ innerRef, draggableProps, dragHandleProps }, { isDragging }) => (
          <div
            {...draggableProps} // eslint-disable-line react/jsx-props-no-spreading
            {...dragHandleProps} // eslint-disable-line react/jsx-props-no-spreading
            ref={innerRef}
            className={classNames(
              styles.queueItem,
              locked && styles.queueItemLocked,
              isDragging && styles.queueItemDragging,
            )}
            data-job={item.jobId}
          >
            <span className={styles.queuePosition}>{index + 1}</span>
            <div className={styles.queueBar}>
              {locked && (
                <Icon
                  name="lock"
                  size="small"
                  title={t(item.e2e ? 'pipeline.lockedE2E' : 'pipeline.lockedPool')}
                />
              )}
              <button type="button" className={styles.barText} onClick={handleNameClick}>
                {item.name || t('pipeline.untitledCard')}
              </button>
            </div>
            <div className={styles.queueDetails}>
              {item.role && <span className={styles.detail}>{item.role}</span>}
              {item.stage && <span className={styles.detail}>{item.stage}</span>}
              {item.e2e && (
                <Label size="mini" className={classNames(styles.chip, styles.buildE2e)}>
                  e2e
                </Label>
              )}
              {item.managesPool && (
                <Label size="mini" className={styles.chip}>
                  {t('pipeline.pool')}
                </Label>
              )}
              {item.priority && item.priority !== 'Normal' && (
                <Label size="mini" className={classNames(styles.chip, styles.chipPriority)}>
                  {item.priority}
                </Label>
              )}
              <span className={styles.detail} title={t('pipeline.waiting')}>
                <Icon name="hourglass start" />
                {formatDuration(secondsWaited, durationUnits)}
              </span>
              {isDragging && dragHint && (
                <Label
                  size="mini"
                  className={classNames(
                    styles.chip,
                    dragHint.allowed ? styles.chipPreview : styles.chipRefused,
                  )}
                >
                  {previewText(t, dragHint)}
                </Label>
              )}
              {(upIndex >= 0 || topIndex >= 0) && (
                <MovePopup
                  upPreview={
                    upIndex >= 0 ? previewText(t, previewRaise(queue, index, upIndex)) : undefined
                  }
                  topPreview={
                    topIndex >= 0 ? previewText(t, previewRaise(queue, index, topIndex)) : undefined
                  }
                  onMoveUp={handleMoveUpClick}
                  onMoveToTop={handleToTopClick}
                >
                  <button
                    type="button"
                    className={styles.queueMenu}
                    title={t('pipeline.moveMenu')}
                    data-action="move-menu"
                  >
                    <Icon name="ellipsis horizontal" />
                  </button>
                </MovePopup>
              )}
            </div>
          </div>
        )}
      </Draggable>
    );
  },
);

QueueItem.propTypes = {
  item: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  index: PropTypes.number.isRequired,
  queue: PropTypes.array.isRequired, // eslint-disable-line react/forbid-prop-types
  canEdit: PropTypes.bool.isRequired,
  dragHint: PropTypes.object, // eslint-disable-line react/forbid-prop-types
  secondsWaited: PropTypes.number.isRequired,
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  onOpenCard: PropTypes.func.isRequired,
  onRaise: PropTypes.func.isRequired,
};

QueueItem.defaultProps = {
  dragHint: undefined,
};

// The queue, in the order dispatch takes it. An editor moves a job up by
// dragging it (only upward, never above an e2e or pool job) or from its
// ▲ Move up / ⤒ To top menu; both say which label the move will apply
// before it is made. `onRaise(fromIndex, aboveIndex, queue)` makes the move,
// with the queue the indexes are into.
const QueuePanel = React.memo(
  ({ queue, canEdit, secondsWaited, durationUnits, onOpenCard, onRaise }) => {
    const [dragHint, setDragHint] = useState(null);
    // The queue as it was when the drag began. A poll landing mid-drag must
    // not reorder the list under the pointer, and the drop is read against
    // the order the person was looking at.
    const [dragQueue, setDragQueue] = useState(null);
    const shownQueue = dragQueue || queue;

    const handleDragStart = useCallback(() => {
      document.body.classList.add(globalStyles.dragging);
      setDragQueue(queue);
    }, [queue]);

    const handleDragUpdate = useCallback(
      ({ source, destination }) => {
        if (!destination || destination.index === source.index) {
          setDragHint(null);
          return;
        }

        setDragHint(
          previewRaise(shownQueue, source.index, dropTargetIndex(source.index, destination.index)),
        );
      },
      [shownQueue],
    );

    const handleDragEnd = useCallback(
      ({ source, destination }) => {
        document.body.classList.remove(globalStyles.dragging);
        setDragHint(null);
        setDragQueue(null);

        if (!destination) {
          return;
        }

        const aboveIndex = dropTargetIndex(source.index, destination.index);

        if (aboveIndex < 0 || !previewRaise(shownQueue, source.index, aboveIndex).allowed) {
          return;
        }

        onRaise(source.index, aboveIndex, shownQueue);
      },
      [shownQueue, onRaise],
    );

    return (
      <DragDropContext
        onDragStart={handleDragStart}
        onDragUpdate={handleDragUpdate}
        onDragEnd={handleDragEnd}
      >
        <Droppable droppableId={DROPPABLE_ID} direction="vertical" isDropDisabled={!canEdit}>
          {({ innerRef, droppableProps, placeholder }) => (
            // eslint-disable-next-line react/jsx-props-no-spreading
            <div {...droppableProps} ref={innerRef} className={styles.queueList}>
              {shownQueue.map((item, index) => (
                <QueueItem
                  key={item.jobId}
                  item={item}
                  index={index}
                  queue={shownQueue}
                  canEdit={canEdit}
                  dragHint={dragHint}
                  secondsWaited={secondsWaited(item)}
                  durationUnits={durationUnits}
                  onOpenCard={onOpenCard}
                  onRaise={onRaise}
                />
              ))}
              {placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    );
  },
);

QueuePanel.propTypes = {
  queue: PropTypes.array.isRequired, // eslint-disable-line react/forbid-prop-types
  canEdit: PropTypes.bool.isRequired,
  secondsWaited: PropTypes.func.isRequired,
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  onOpenCard: PropTypes.func.isRequired,
  onRaise: PropTypes.func.isRequired,
};

export default QueuePanel;
