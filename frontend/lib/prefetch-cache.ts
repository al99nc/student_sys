// Module-level store for promises fired during the welcome animation.
// Dashboard reads from here first — if resolved, data is instant.
export const prefetch: {
  dashboard?: Promise<any>;
  lectures?: Promise<any>;
  sharedSessions?: Promise<any>;
  nextAction?: Promise<any>;
  dailyMission?: Promise<any>;
} = {};
