/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { createContext } from 'react';

// The card being dragged on the kanban board and, when it carries the selection along,
// how many cards move with it (0 otherwise)
export default createContext({
  draggingCardId: null,
  groupSize: 0,
});
