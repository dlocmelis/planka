/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from 'semantic-ui-react';

import { VoiceChatPhases } from '../../../utils/voice-chat';

import styles from './VoiceStatus.module.scss';

/** What each phase says. Kept as one map rather than a switch inline in the
 * JSX so the copy is one thing to read and one thing to translate. */
const PHASE_KEYS = {
  [VoiceChatPhases.STARTING]: 'common.voiceChatOpeningMicrophone',
  [VoiceChatPhases.LISTENING]: 'common.voiceChatListening',
  [VoiceChatPhases.CAPTURING]: 'common.voiceChatHearingYou',
  [VoiceChatPhases.TRANSCRIBING]: 'common.voiceChatTranscribing',
  [VoiceChatPhases.THINKING]: 'common.voiceChatWaitingForBot',
  [VoiceChatPhases.SPEAKING]: 'common.voiceChatSpeaking',
  [VoiceChatPhases.BLOCKED]: 'common.voiceChatNotAvailable',
};

/**
 * The line under the composer while voice chat is on.
 *
 * It is the only thing on this panel that changes without anyone touching it —
 * the loop moves from listening to hearing you to sending on its own — so it is
 * a `role="status"` live region rather than a decoration: a hands-free user is
 * by definition not looking at the screen, and a screen reader announcing "I am
 * sending that now" is the whole feedback they get.
 *
 * The interrupt button lives here rather than beside Send because it only
 * exists while the answer is being read aloud, and this loop is half-duplex —
 * talking over the answer is not how you stop it (see `utils/voice-chat.js`).
 */
const VoiceStatus = React.memo(({ phase, notice, onStopSpeaking }) => {
  const [t] = useTranslation();

  if (phase === VoiceChatPhases.OFF && !notice) {
    return null;
  }

  const key = PHASE_KEYS[phase];
  const isRunning = phase !== VoiceChatPhases.OFF;

  return (
    <div role="status" className={styles.wrapper}>
      <div className={styles.line}>
        {phase === VoiceChatPhases.CAPTURING && (
          <span className={styles.pulse} aria-hidden="true">
            <Icon fitted name="microphone" />
          </span>
        )}
        {phase !== VoiceChatPhases.CAPTURING && isRunning && (
          <Icon fitted name={phase === VoiceChatPhases.BLOCKED ? 'ban' : 'circle notch'} />
        )}
        {/* The notice is a SECOND line while the loop is still running, not a
            replacement for the first: "that recording was too long" is what
            just happened, and "listening" is what is happening now. It only
            stands alone when the mode itself is off, where there is no
            "now". */}
        <span className={styles.text}>{isRunning ? key && t(key) : notice}</span>
        {phase === VoiceChatPhases.SPEAKING && (
          <Button type="button" basic size="mini" className={styles.stop} onClick={onStopSpeaking}>
            {t('action.stopSpeaking')}
          </Button>
        )}
      </div>
      {isRunning && notice && <div className={styles.notice}>{notice}</div>}
    </div>
  );
});

VoiceStatus.propTypes = {
  phase: PropTypes.string.isRequired,
  notice: PropTypes.string,
  onStopSpeaking: PropTypes.func.isRequired,
};

VoiceStatus.defaultProps = {
  notice: undefined,
};

export default VoiceStatus;
