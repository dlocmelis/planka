/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

const SECRET_CONTENT_SENTINEL = '••••••••';

const maskCustomFieldValue = (customFieldValue, customField) => {
  if (!customFieldValue || !customField || !customField.isSecret) {
    return customFieldValue;
  }

  return {
    ...customFieldValue,
    content: SECRET_CONTENT_SENTINEL,
  };
};

const maskCustomFieldValues = (customFieldValues, customFields) =>
  customFieldValues.map((customFieldValue) => {
    const customField = customFields.find(
      (customFieldItem) => customFieldItem.id === customFieldValue.customFieldId,
    );

    return maskCustomFieldValue(customFieldValue, customField);
  });

module.exports = {
  SECRET_CONTENT_SENTINEL,
  maskCustomFieldValue,
  maskCustomFieldValues,
};
