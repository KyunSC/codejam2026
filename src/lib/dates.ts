// The business date the app runs on: AS_OF_DATE when set, otherwise the server's date.
export const today = () => process.env.AS_OF_DATE || new Date().toLocaleDateString("en-CA");
