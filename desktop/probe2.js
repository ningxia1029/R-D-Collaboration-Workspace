const e = require("electron");
console.log("type:", typeof e);
console.log("app:", typeof e.app);
console.log("default:", typeof e.default);
console.log("electron version:", process.versions.electron);
console.log("sample keys:", Object.getOwnPropertyNames(e).slice(0, 10).join(","));
process.exit(0);
