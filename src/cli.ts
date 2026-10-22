import { bestPowerCurve, loadCoverage, recomputeDailyLoad } from './calc/load.js';
import { closeDb, db } from './db/index.js';
import { setThrottleListener } from './garmin/client.js';
import { syncFitFiles } from './sync/fit.js';
import { verifyPowerCurves, type PowerCheckResult } from './sync/powerCheck.js';
import { backfillFromRaw, syncActivities } from './sync/import.js';

const log = (message: string) => process.stdout.write(message + '\n');

setThrottleListener((seconds) => log(`  rate limited, waiting ${seconds}s`));

async function commandSync(args: string[]): Promise<void> {
  const incremental = args.includes('--incremental');
  const withFit = args.includes('--fit');
  const keepFiles = !args.includes('--discard-files');

  log(`Syncing activities (${incremental ? 'incremental' : 'full'})...`);
  const result = await syncActivities({ incremental, onProgress: log });
  log(
    `  ${result.seen} seen, ${result.added} added, ${result.updated} updated, ` +
      `${result.detailsFetched} details fetched`,
  );
  log(`  coverage ${result.coverageStart} to ${result.coverageEnd}`);

  if (withFit) {
    log('Downloading FIT files for powered rides...');
    const fit = await syncFitFiles({ onProgress: log, keepFiles });
    log(
      `  ${fit.downloaded} downloaded, ${fit.reparsed} parsed from disk, ` +
        `${fit.skipped} skipped, ${fit.failed} failed`,
    );
    logPowerCheck(fit.check);
  }

  log('Recomputing load model...');
  const load = recomputeDailyLoad();
  if (load) log(`  ${load.days} days from ${load.from} to ${load.to}`);
}

function logPowerCheck(check: PowerCheckResult): void {
  log(
    `  power curves against Garmin's figures: ${check.agreed} agree, ` +
      `${check.flagged.length} disagree, ${check.unverifiable} with nothing to check`,
  );
  for (const ride of check.flagged) {
    log(`    #${ride.activity_id} ${ride.local_date}  ${ride.reason}`);
  }
  if (check.flagged.length > 0) {
    log('  Those rides are left out of the power records until a FIT sync parses them again.');
  }
}

function commandStats(): void {
  const database = db();
  const coverage = loadCoverage();

  log('');
  log(`Activities:        ${coverage.total}`);
  log(`  with training load: ${coverage.withLoad} (${pct(coverage.withLoad, coverage.total)})`);
  log(`  with TSS (power):   ${coverage.withTss} (${pct(coverage.withTss, coverage.total)})`);
  log(
    `  load not trustworthy: ${coverage.unreliableLoad} (missing, or recorded without a heart-rate strap)`,
  );

  const byType = database
    .prepare(
      `SELECT activity_type, COUNT(*) AS n,
              SUM(CASE WHEN avg_power IS NOT NULL THEN 1 ELSE 0 END) AS powered,
              ROUND(SUM(COALESCE(distance_m,0))/1000) AS km,
              ROUND(SUM(COALESCE(duration_s,0))/3600) AS hours
         FROM activity GROUP BY activity_type ORDER BY n DESC`,
    )
    .all() as { activity_type: string; n: number; powered: number; km: number; hours: number }[];

  log('');
  log('Type                  rides  powered       km    hours');
  for (const row of byType) {
    log(
      row.activity_type.padEnd(20) +
        String(row.n).padStart(7) +
        String(row.powered).padStart(9) +
        String(row.km).padStart(9) +
        String(row.hours).padStart(9),
    );
  }

  const latest = database
    .prepare(
      `SELECT local_date, fitness, fatigue, form, is_warmup FROM daily_load
        ORDER BY local_date DESC LIMIT 1`,
    )
    .get() as
    | { local_date: string; fitness: number; fatigue: number; form: number; is_warmup: number }
    | undefined;

  if (latest) {
    log('');
    log(`Load model as of ${latest.local_date} (Garmin training-load points):`);
    log(`  fitness ${latest.fitness.toFixed(1)}   fatigue ${latest.fatigue.toFixed(1)}   form ${latest.form.toFixed(1)}`);
  }

  const curve = bestPowerCurve();
  if (curve.length > 0) {
    log('');
    log('All-time peak power:');
    for (const point of curve) {
      log(
        `  ${formatDuration(point.duration_s).padEnd(8)} ${String(Math.round(point.watts)).padStart(4)} W   ${point.local_date}`,
      );
    }
  }

  const ftp = database
    .prepare(
      `SELECT local_date, ftp_at_ride FROM activity
        WHERE ftp_at_ride IS NOT NULL ORDER BY local_date DESC LIMIT 1`,
    )
    .get() as { local_date: string; ftp_at_ride: number } | undefined;
  if (ftp) {
    log('');
    log(`FTP as of ${ftp.local_date}: ${ftp.ftp_at_ride} W (Garmin estimate)`);
  }
  log('');
}

const pct = (part: number, whole: number) =>
  whole === 0 ? '0%' : `${Math.round((100 * part) / whole)}%`;

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}min`;
  return `${seconds / 3600}h`;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  try {
    switch (command) {
      case 'sync':
        await commandSync(args);
        commandStats();
        break;
      case 'stats':
        commandStats();
        break;
      case 'recompute': {
        const load = recomputeDailyLoad();
        if (load) log(`Recomputed ${load.days} days from ${load.from} to ${load.to}`);
        commandStats();
        break;
      }
      case 'backfill': {
        const filled = backfillFromRaw();
        log(`Read ${filled.rides} stored list payloads; ${filled.withZones} carried heart-rate zones`);
        break;
      }
      case 'verify-power':
        log("Checking stored power curves against Garmin's figures...");
        logPowerCheck(verifyPowerCurves());
        break;
      default:
        log('Usage: npm run sync [-- --fit --incremental --discard-files]');
        log('       npm run stats');
        log('       npx tsx src/cli.ts recompute');
        log('       npx tsx src/cli.ts backfill   # promote stored fields, no network');
        log('       npx tsx src/cli.ts verify-power   # check power curves, no network');
        process.exitCode = 1;
    }
  } finally {
    closeDb();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
