/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

// eslint-disable-next-line import/prefer-default-export
export const shouldRenderListCollapsed = ({
  isCollapsed,
  totalCardsCount,
  isCardsFetching,
  isDragActive,
  isPeek,
}) => isCollapsed || (totalCardsCount === 0 && !isCardsFetching && !isDragActive && !isPeek);
