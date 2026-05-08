(async () => {
  try {
    await import("./server/server.js");
  } catch (error) {
    console.error("Stock Flow failed to start.");
    console.error(error);
    process.exit(1);
  }
})();
