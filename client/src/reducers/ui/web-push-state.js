/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import ActionTypes from '../../constants/ActionTypes';

const initialState = {
  isSubmitting: false,
  error: null,
  isTesting: false,
  isTestSuccessful: false,
  testError: null,
};

// eslint-disable-next-line default-param-last
export default (state = initialState, { type, payload }) => {
  switch (type) {
    case ActionTypes.PUSH_SUBSCRIPTION_CREATE:
    case ActionTypes.PUSH_SUBSCRIPTION_DELETE:
      return {
        ...state,
        isSubmitting: true,
        error: null,
      };
    case ActionTypes.PUSH_SUBSCRIPTION_CREATE__SUCCESS:
    case ActionTypes.PUSH_SUBSCRIPTION_DELETE__SUCCESS:
    case ActionTypes.PUSH_SUBSCRIPTION_DELETE__FAILURE:
      return {
        ...state,
        isSubmitting: false,
      };
    case ActionTypes.PUSH_SUBSCRIPTION_CREATE__FAILURE:
      return {
        ...state,
        isSubmitting: false,
        error: payload.error,
      };
    case ActionTypes.PUSH_SUBSCRIPTION_TEST:
      return {
        ...state,
        isTesting: true,
        isTestSuccessful: false,
        testError: null,
      };
    case ActionTypes.PUSH_SUBSCRIPTION_TEST__SUCCESS:
      return {
        ...state,
        isTesting: false,
        isTestSuccessful: true,
      };
    case ActionTypes.PUSH_SUBSCRIPTION_TEST__FAILURE:
      return {
        ...state,
        isTesting: false,
        testError: payload.error,
      };
    default:
      return state;
  }
};
