import cron from 'node-cron';
import { main as runCheckin } from './endfield_checkin.js';
import dotenv from 'dotenv';

dotenv.config();

// Schedule daily at 09:00 server local time
cron.schedule('0 9 * * *', async () => {
  console.log('[Scheduler] Running daily Endfield check-in at 9am');
  try {
    await runCheckin();
  } catch (err) {
    console.error('[Scheduler] Check-in error:', err);
  }
});

console.log('✅ Endfield check‑in scheduler started – will run daily at 09:00');
