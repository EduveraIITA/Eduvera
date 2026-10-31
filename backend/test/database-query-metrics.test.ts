import { expect,it } from 'vitest';
import { DatabaseQueryMetrics } from '../src/database/query-metrics.js';
it('keeps finite content-free SQL telemetry with cumulative buckets and failures',()=>{
  const metrics=new DatabaseQueryMetrics();metrics.record(3);metrics.record(300,true);metrics.record(90000);metrics.record(NaN);
  const output=metrics.prometheus();
  expect(output).toContain('seconds_bucket{le="0.005"} 1');
  expect(output).toContain('seconds_bucket{le="0.5"} 2');
  expect(output).toContain('seconds_bucket{le="+Inf"} 3');
  expect(output).toContain('failures_total 1');
  expect(output).not.toMatch(/tenant|student|SELECT|parameter/);
});
