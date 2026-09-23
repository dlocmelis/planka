/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { Menu } from 'semantic-ui-react';
import { Popup } from '../../../lib/custom-ui';

import styles from './PipelineStrip.module.scss';

// A queued job's ▲ Move up / ⤒ To top menu. Each entry says, before it is
// chosen, which priority label the move will apply. A popup rather than an
// inline dropdown, because the strip scrolls and would clip one.
const MoveStep = React.memo(({ upPreview, topPreview, onMoveUp, onMoveToTop, onClose }) => {
  const [t] = useTranslation();

  const handleMoveUpClick = useCallback(() => {
    onMoveUp();
    onClose();
  }, [onMoveUp, onClose]);

  const handleMoveToTopClick = useCallback(() => {
    onMoveToTop();
    onClose();
  }, [onMoveToTop, onClose]);

  return (
    <>
      <Popup.Header>{t('pipeline.moveMenu')}</Popup.Header>
      <Popup.Content>
        <Menu secondary vertical className={styles.moveMenu}>
          {upPreview && (
            <Menu.Item data-move="up" onClick={handleMoveUpClick}>
              ▲ {t('pipeline.moveUp')}
              <div className={styles.menuPreview}>{upPreview}</div>
            </Menu.Item>
          )}
          {topPreview && (
            <Menu.Item data-move="top" onClick={handleMoveToTopClick}>
              ⤒ {t('pipeline.toTop')}
              <div className={styles.menuPreview}>{topPreview}</div>
            </Menu.Item>
          )}
        </Menu>
      </Popup.Content>
    </>
  );
});

MoveStep.propTypes = {
  upPreview: PropTypes.string,
  topPreview: PropTypes.string,
  onMoveUp: PropTypes.func.isRequired,
  onMoveToTop: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

MoveStep.defaultProps = {
  upPreview: undefined,
  topPreview: undefined,
};

export default MoveStep;
