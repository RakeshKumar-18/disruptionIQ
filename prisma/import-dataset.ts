// Rebuilds the database from data/*.csv (replaces everything). Run: npm run db:import
import { db } from "../src/lib/db";
import { importDataset } from "../src/lib/dataset";

const started = Date.now();
importDataset(db)
  .then(() => console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s.`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
