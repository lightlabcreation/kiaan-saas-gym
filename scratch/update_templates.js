import { pool } from "../src/config/db.js";

async function run() {
  try {
    await pool.query("UPDATE message_templates SET channel = 'EMAIL,IN_APP,WHATSAPP'");
    console.log("✅ All message templates channels updated to EMAIL,IN_APP,WHATSAPP");
  } catch (err) {
    console.error("Error updating templates:", err);
  } finally {
    process.exit(0);
  }
}

run();
