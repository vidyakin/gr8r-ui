/* Табличные части документа во вкладках (как в 1С): шапка — над вкладками, итоги и комментарий — под ними.
   Одна табличная часть — без полосы вкладок */
import * as React from 'react';
import { Tab, Tabs, TabsContent, TabsList } from '@/components/ui';

export interface DocTab {
  id: string;
  label: string;
  /** Число строк на ярлыке вкладки */
  count?: number;
  content: React.ReactNode;
}

export function DocTabs({ tabs, label }: { tabs: (DocTab | false | null | undefined)[]; label: string }) {
  const visible = tabs.filter((x): x is DocTab => !!x);
  const [active, setActive] = React.useState(visible[0]?.id ?? '');
  if (!visible.length) return null;
  if (visible.length === 1) return <>{visible[0]!.content}</>;
  const value = visible.some(x => x.id === active) ? active : visible[0]!.id;
  return (
    <Tabs className="doc-tabsec" value={value} onValueChange={setActive}>
      <TabsList aria-label={label}>
        {visible.map(x => (
          <Tab key={x.id} value={x.id} count={x.count}>
            {x.label}
          </Tab>
        ))}
      </TabsList>
      {visible.map(x => (
        <TabsContent key={x.id} value={x.id}>
          {x.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
