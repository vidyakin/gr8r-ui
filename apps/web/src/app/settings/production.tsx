/* Settings → Production: источник цены материалов при расчёте себестоимости (настройка воркспейса, меняет admin и выше). */
import * as React from 'react';
import { Link } from 'react-router';
import { MATERIAL_PRICE_SOURCES, type MaterialPriceSource } from '@gr8r/shared';
import { Alert, Button, Field, Input, Radio, Skeleton, toast } from '@/components/ui';
import { useIsAdmin } from '../catalog/data';
import { useProductionApi, useSnapshot } from '../production/data';
import { usePeriods, usePeriodSettings } from '../production/closing-data';
import { SettingsHead, Toggle } from './parts';
import { useT } from '@/i18n';

export function ProductionSection({ title }: { title: string }) {
  const t = useT();
  const isAdmin = useIsAdmin();
  const snap = useSnapshot();
  const api = useProductionApi();
  const periods = usePeriods();
  const lock = usePeriodSettings();
  const saved = snap.data?.settings.materialPriceSource;
  // Выбор виден сразу, не дожидаясь ответа сервера; при ошибке возвращается сохранённое значение
  const [picked, setPicked] = React.useState<MaterialPriceSource | null>(null);
  const current = picked ?? saved;

  const choose = async (v: MaterialPriceSource) => {
    if (v === current) return;
    setPicked(v);
    const ok = await api('PATCH', '/production/settings', { materialPriceSource: v });
    if (ok) toast(t('settings.production.priceSource.saved'), { duration: 1500 });
    setPicked(null);
  };

  const optTitle = (v: MaterialPriceSource) => t(`settings.production.priceSource.options.${v}.title` as 'settings.production.priceSource.options.purchase.title');
  const optDesc = (v: MaterialPriceSource) => t(`settings.production.priceSource.options.${v}.desc` as 'settings.production.priceSource.options.purchase.desc');

  return (
    <>
      <SettingsHead title={title} lead={t('settings.production.lead')} />
      <div className="sblock">
        <h2>{t('settings.production.priceSource.title')}</h2>
        <p className="muted" style={{ margin: '4px 0 12px' }}>
          {t('settings.production.priceSource.hint')}
        </p>
        {snap.isPending ? (
          <Skeleton w="100%" h={90} />
        ) : (
          <div className="stack" style={{ gap: 8 }} role="radiogroup" aria-label={t('settings.production.priceSource.aria')}>
            {MATERIAL_PRICE_SOURCES.map(v => (
              <label key={v} className="srow" style={{ cursor: !isAdmin ? 'default' : 'pointer' }}>
                <div>
                  <div className="t">{optTitle(v)}</div>
                  <div className="d">{optDesc(v)}</div>
                </div>
                <div className="row">
                  <Radio name="price-source" value={v} aria-label={optTitle(v)} checked={current === v} disabled={!isAdmin} onChange={() => void choose(v)} />
                </div>
              </label>
            ))}
          </div>
        )}
        {!isAdmin && (
          <Alert tone="info" className="mt-3">
            {t('settings.production.onlyAdmins')}
          </Alert>
        )}
      </div>
      <div className="sblock">
        <h2>{t('settings.production.periodClosing.title')}</h2>
        <p className="muted" style={{ margin: '4px 0 12px' }}>
          {t('settings.production.periodClosing.hint')}
        </p>
        <div className="stack" style={{ gap: 10 }}>
          <Field label={t('settings.production.periodClosing.lockLabel')}>
            {p => (
              <div className="row" style={{ gap: 8 }}>
                <Input {...p} type="date" value={periods.data?.closedThrough ?? ''} disabled={!isAdmin} onChange={e => void lock.mutateAsync({ closedThrough: e.target.value || null }).catch(err => toast.error(err.message))} />
                <Button size="sm" disabled={!isAdmin || !periods.data?.closedThrough} onClick={() => void lock.mutateAsync({ closedThrough: null }).then(() => toast(t('settings.production.periodClosing.unlocked'), { duration: 1500 }))}>
                  {t('settings.production.periodClosing.unlock')}
                </Button>
              </div>
            )}
          </Field>
          <label className="srow">
            <div>
              <div className="t">{t('settings.production.periodClosing.moveLockTitle')}</div>
              <div className="d">{t('settings.production.periodClosing.moveLockHint')}</div>
            </div>
            <Toggle
              checked={periods.data?.closeMovesLock ?? false}
              label={t('settings.production.periodClosing.moveLockTitle')}
              onChange={v => void lock.mutateAsync({ closeMovesLock: v }).then(() => toast(t('settings.production.periodClosing.saved'), { duration: 1200 }))}
            />
          </label>
        </div>
        <p className="muted" style={{ margin: '10px 0 0' }}>
          <Link to="/production/closing" className="crm-link">
            {t('settings.production.periodClosing.openClosing')}
          </Link>
          {t('settings.production.periodClosing.openClosingHint')}
        </p>
      </div>
      <div className="sblock">
        <h2>{t('settings.production.workCenters.title')}</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          {t('settings.production.workCenters.hintStart')}
          <Link to="/work-centers" className="crm-link">
            {t('settings.production.workCenters.link')}
          </Link>
          {t('settings.production.workCenters.hintEnd')}
        </p>
      </div>
    </>
  );
}
