/* Сводка о ходе работ по объекту на клиенте (задача 1277): настройка расписания и «Отправить сейчас».
   Запросы живут под ['ws', id, 'objects', …] — событие object_report.* сбрасывает их через realtime.
   Печать отчёта для заказчика открывается тем же приёмом, что печать актов (usePrintOpener). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ObjectReportScheduleView, ObjectReportScheduleSave } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';
import { objectsKey } from './data';

export type ReportSchedule = ObjectReportScheduleView;
export type ReportScheduleInput = ObjectReportScheduleSave;

/** Настройка «Сводка о ходе работ» объекта */
export function useObjectReportSchedule(id: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: objectsKey(ws, 'report-schedule', id),
    queryFn: () => call<ReportSchedule>(ws, 'GET', `/objects/${id}/report-schedule`),
    enabled: !!id,
  });
}

export function useObjectReportApi(objectId: string | undefined) {
  const ws = useWsId();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: objectsKey(ws) });
  const saveSchedule = useMutation({
    mutationFn: (input: ReportScheduleInput) => call<ReportSchedule>(ws, 'PUT', `/objects/${objectId}/report-schedule`, input),
    onSuccess: invalidate,
  });
  const sendNow = useMutation({
    mutationFn: () => call<{ notifications: number }>(ws, 'POST', `/objects/${objectId}/report-now`, {}),
    onSuccess: invalidate,
  });
  return { saveSchedule, sendNow };
}
