/* zod-схемы маршрутизации (задача 1213, docs/architecture/routing.md). */
import { z } from 'zod';
import { ROUTING_PROVIDERS, routingUrlError } from '../routing';
import { hhmm, isoDate } from './common';

const url = z
  .string()
  .trim()
  .max(500)
  .superRefine((v, ctx) => {
    const e = routingUrlError(v);
    if (e) ctx.addIssue({ code: 'custom', message: e });
  });

export const routingSettingsSave = z.object({
  provider: z.enum(ROUTING_PROVIDERS),
  osrmUrl: url.default(''),
  vroomUrl: url.default(''),
  nominatimUrl: url.default(''),
  yandexMapsKey: z.string().trim().max(200).default(''),
  depotAddress: z.string().trim().max(500).default(''),
  depotLat: z.number().min(-90).max(90).nullable().default(null),
  depotLon: z.number().min(-180).max(180).nullable().default(null),
  serviceMinutes: z.number().int().min(0).max(240).default(10),
  dayStart: hhmm.default('09:00'),
  citySpeedKmh: z.number().min(5).max(120).default(30),
  roadSpeedKmh: z.number().min(10).max(150).default(60),
});

/** Распределение: машины (пусто — все свободные на день) */
export const routingDistribute = z.object({ date: isoDate, vehicleIds: z.array(z.uuid()).max(100).optional() });
export const routingOptimize = z.object({ reorder: z.boolean().default(true) });
