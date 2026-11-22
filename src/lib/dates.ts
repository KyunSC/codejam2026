// The date the checks treat as today: the as-of date setting (AS_OF_DATE, the dataset's 2026-11-02), not the server clock.
export const today = () => process.env.AS_OF_DATE || new Date().toLocaleDateString("en-CA");
