/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

export const isCardDndId = (dndId) => typeof dndId === 'string' && dndId.startsWith('card:');

export default (dndId) => dndId.split(':')[1];
