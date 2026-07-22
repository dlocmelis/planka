/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { useDidUpdate, usePrevious, useToggle } from '../../../lib/hooks';
import { Input } from '../../../lib/custom-ui';

import { useEscapeInterceptor, useField, useNestedRef } from '../../../hooks';

import styles from './ValueField.module.scss';

const ValueField = React.memo(({ defaultValue, isSecret, onUpdate, ...props }) => {
  const [t] = useTranslation();

  const prevDefaultValue = usePrevious(defaultValue);
  const [value, handleChange, setValue] = useField(isSecret ? '' : defaultValue || '');
  const [blurFieldState, blurField] = useToggle();

  const [fieldRef, handleFieldRef] = useNestedRef('inputRef');
  const isFocusedRef = useRef(false);

  const handleEscape = useCallback(() => {
    setValue(isSecret ? '' : defaultValue || '');
    blurField();
  }, [isSecret, defaultValue, setValue, blurField]);

  const [activateEscapeInterceptor, deactivateEscapeInterceptor] =
    useEscapeInterceptor(handleEscape);

  const handleFocus = useCallback(() => {
    activateEscapeInterceptor();
    isFocusedRef.current = true;
  }, [activateEscapeInterceptor]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        fieldRef.current.blur();
      }
    },
    [fieldRef],
  );

  const handleBlur = useCallback(() => {
    deactivateEscapeInterceptor();
    isFocusedRef.current = false;

    const cleanValue = value.trim() || null;

    if (isSecret) {
      if (cleanValue) {
        onUpdate(cleanValue);
      }

      setValue('');
      return;
    }

    if (cleanValue !== defaultValue) {
      onUpdate(cleanValue);
    }
  }, [isSecret, defaultValue, onUpdate, value, setValue, deactivateEscapeInterceptor]);

  useDidUpdate(() => {
    if (!isSecret && !isFocusedRef.current && defaultValue !== prevDefaultValue) {
      setValue(defaultValue || '');
    }
  }, [isSecret, defaultValue, prevDefaultValue]);

  useDidUpdate(() => {
    fieldRef.current.blur();
  }, [blurFieldState]);

  const InputComponent = isSecret ? Input.Password : Input;

  return (
    <InputComponent
      {...props} // eslint-disable-line react/jsx-props-no-spreading
      fluid
      ref={handleFieldRef}
      value={value}
      maxLength={512}
      placeholder={isSecret && defaultValue ? t('common.passwordIsSet') : undefined}
      className={styles.field}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
});

ValueField.propTypes = {
  defaultValue: PropTypes.string,
  isSecret: PropTypes.bool,
  onUpdate: PropTypes.func.isRequired,
};

ValueField.defaultProps = {
  defaultValue: undefined,
  isSecret: false,
};

export default ValueField;
