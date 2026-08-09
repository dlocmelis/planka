/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

export const selectIsSocketDisconnected = ({ socket: { isDisconnected } }) => isDisconnected;

export const selectIsInitializing = ({ common: { isInitializing } }) => isInitializing;

export const selectBootstrap = ({ common: { bootstrap } }) => bootstrap;

export const selectOidcBootstrap = (state) => selectBootstrap(state).oidc;

export const selectActiveUsersLimit = (state) => selectBootstrap(state).activeUsersLimit;

/**
 * What the voice chat mode of the planka_bot panel may do on this deployment.
 *
 * ABSENCE IS OFF, and that is the whole reason this returns a frozen literal
 * rather than the raw field: a server too old to send `voiceChat`, and a
 * bootstrap that has not arrived, must not render a microphone whose endpoint
 * would answer 503. The frozen constant also keeps the selector referentially
 * stable, so a component that depends on it does not re-render every tick.
 */
const VOICE_CHAT_OFF = Object.freeze({
  sttEnabled: false,
  ttsEnabled: false,
  sttMaxBytes: null,
  sttMaxDurationSec: null,
  ttsMaxChars: null,
});

export const selectVoiceChatCapability = (state) => {
  const bootstrap = selectBootstrap(state);

  return (bootstrap && bootstrap.voiceChat) || VOICE_CHAT_OFF;
};

export const selectAccessToken = ({ auth: { accessToken } }) => accessToken;

export const selectAuthenticateForm = ({ ui: { authenticateForm } }) => authenticateForm;

export const selectUserCreateForm = ({ ui: { userCreateForm } }) => userCreateForm;

export const selectProjectCreateForm = ({ ui: { projectCreateForm } }) => projectCreateForm;

export const selectSmtpTestState = ({ ui: { smtpTestState } }) => smtpTestState;

export default {
  selectIsSocketDisconnected,
  selectIsInitializing,
  selectBootstrap,
  selectOidcBootstrap,
  selectActiveUsersLimit,
  selectVoiceChatCapability,
  selectAccessToken,
  selectAuthenticateForm,
  selectUserCreateForm,
  selectProjectCreateForm,
  selectSmtpTestState,
};
