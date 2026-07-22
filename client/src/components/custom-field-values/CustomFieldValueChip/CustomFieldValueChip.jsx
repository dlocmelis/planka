/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import upperFirst from 'lodash/upperFirst';
import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { useSelector } from 'react-redux';

import selectors from '../../../selectors';

import styles from './CustomFieldValueChip.module.scss';

const SECRET_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

const Sizes = {
  TINY: 'tiny',
  SMALL: 'small',
  MEDIUM: 'medium',
};

const CustomFieldValueChip = React.memo(({ id, size, onClick }) => {
  const selectCustomFieldValueById = useMemo(() => selectors.makeSelectCustomFieldValueById(), []);
  const selectCustomFieldById = useMemo(() => selectors.makeSelectCustomFieldById(), []);

  const customFieldValue = useSelector((state) => selectCustomFieldValueById(state, id));

  const customField = useSelector((state) =>
    selectCustomFieldById(state, customFieldValue.customFieldId),
  );

  const contentNode = (
    <span
      title={
        customField.isSecret ? customField.name : `${customField.name}: ${customFieldValue.content}`
      }
      className={classNames(
        styles.wrapper,
        styles[`wrapper${upperFirst(size)}`],
        onClick && styles.wrapperHoverable,
      )}
    >
      {customField.isSecret ? (
        SECRET_MASK
      ) : (
        <>
          {!Number.isNaN(parseFloat(customFieldValue.content)) && `${customField.name}: `}
          {customFieldValue.content}
        </>
      )}
    </span>
  );

  return onClick ? (
    <button
      type="button"
      disabled={customField.isDisabled}
      className={styles.button}
      onClick={onClick}
    >
      {contentNode}
    </button>
  ) : (
    contentNode
  );
});

CustomFieldValueChip.propTypes = {
  id: PropTypes.string.isRequired,
  size: PropTypes.oneOf(Object.values(Sizes)),
  onClick: PropTypes.func,
};

CustomFieldValueChip.defaultProps = {
  size: Sizes.MEDIUM,
  onClick: undefined,
};

export default CustomFieldValueChip;
