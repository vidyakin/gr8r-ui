import * as React from 'react';
import { ArrowRight, Check, GitBranch, Zap } from 'lucide-react';
import { tasksScene } from '../demo/TasksScene';
import { docScene } from '../demo/DocScene';
import { servicesScene } from '../demo/ServicesScene';
import { productionScene } from '../demo/ProductionScene';
import { DemoShell } from '../demo/shell';
import { t } from '../i18n';
import type { AlternativeModuleId } from './AlternativeLanding';

// Уже готовые кадры первого лендинга сохраняют внешний вид настоящего приложения.
const context = { compact: false, cursor: { x: 0, y: 0, dur: 0, down: false, shown: false } };
const SCENES = {
  tasks: () => tasksScene.render(tasksScene.initial, context),
  docs: () => docScene.render(docScene.final, context),
  services: () => servicesScene.render(servicesScene.final, context),
  production: () => productionScene.render(productionScene.initial, context),
};

export function ModulePreview({ id }: { id: AlternativeModuleId }) {
  const container = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const node = container.current!;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="alt-screen" ref={container}>
      {id === 'crm' ? (
        <img className="alt-crm-shot" src={`${import.meta.env.BASE_URL}alternative/crm-dashboard.png`} alt={t('alternative.crmScreenshot')} width="1440" height="1238" />
      ) : (
        <div className="alt-screen-canvas" style={{ transform: `scale(${width / 1120})` }} inert aria-hidden="true" key={id}>
          {id in SCENES ? SCENES[id as keyof typeof SCENES]() : <AdditionalPreview id={id as 'sales' | 'logistics' | 'automations' | 'payroll'} />}
        </div>
      )}
    </div>
  );
}

function AdditionalPreview({ id }: { id: 'sales' | 'logistics' | 'automations' | 'payroll' }) {
  const preview = t(`alternative.modules.${id}.name`);
  const rows = {
    sales: [
      ['РЛ-000184', 'ООО «Атлас Мебель»', 'Реализация', '318 000 ₽', 'Проведён'],
      ['СЧ-000217', 'ИП Петров А. В.', 'Счёт покупателю', '124 500 ₽', 'Оплачен'],
      ['ЗК-000118', 'ООО «Мастерская»', 'Заказ покупателя', '86 400 ₽', 'В работе'],
      ['РЛ-000183', 'ООО «Север»', 'Реализация', '52 800 ₽', 'Проведён'],
    ],
    logistics: [
      ['РС-000028', 'Алексей Смирнов', 'Центральный район', '6 доставок', 'В пути'],
      ['РС-000027', 'Дмитрий Волков', 'Северный район', '4 доставки', 'Завершён'],
      ['РС-000029', 'Сергей Орлов', 'Южный район', '5 доставок', 'Запланирован'],
    ],
    payroll: [
      ['ТД-000012', 'Алексей Смирнов', 'Производство', '84 000 ₽', 'Начислено'],
      ['ТД-000008', 'Мария Лебедева', 'Продажи', '92 500 ₽', 'Начислено'],
      ['ТД-000015', 'Дмитрий Волков', 'Логистика', '68 000 ₽', 'Выплачено'],
      ['ТД-000003', 'Анна Кузнецова', 'Администрация', '78 000 ₽', 'Выплачено'],
    ],
  };
  const headers = {
    sales: ['Документ', 'Покупатель', 'Тип', 'Сумма', 'Статус'],
    logistics: ['Рейс', 'Курьер', 'Маршрут', 'Заказы', 'Статус'],
    payroll: ['Сотрудник', 'ФИО', 'Подразделение', 'К выплате', 'Статус'],
  };
  return (
    <DemoShell compact={false} active={id === 'sales' ? 'sales' : 'home'} crumbs={[preview]}>
      <div className="d-ph"><h1>{preview}</h1></div>
      {id === 'automations' ? (
        <div className="alt-workflow">
          {[[Zap, 'Сделка выиграна', 'Событие в CRM'], [GitBranch, 'Сумма больше 100 000 ₽', 'Проверка условия'], [Check, 'Создать заказ и задачу', 'Действие']] .map(([Icon, title, text], index) => {
            const NodeIcon = Icon as typeof Zap;
            return <React.Fragment key={String(title)}>{index > 0 && <ArrowRight size={24} />}<div className="alt-workflow-node"><NodeIcon size={25} /><strong>{String(title)}</strong><span>{String(text)}</span></div></React.Fragment>;
          })}
        </div>
      ) : (
        <section className="panel d-wb"><table className="dtbl"><thead><tr>{headers[id].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows[id].map(row => <tr key={row[0]}>{row.map((value, index) => <td key={index}>{index === 4 ? <span className="badge green">{value}</span> : value}</td>)}</tr>)}</tbody></table></section>
      )}
    </DemoShell>
  );
}
