/* Формы документов: вкладки табличных частей (как в 1С), подсказки клавиш, комментарий внизу */
export const docs = {
  comment: 'Comment',
  commentHint: {
    document: 'Internal note or payment terms',
    productionOrder: 'What is this order for',
    otherCosts: 'What these costs are for',
  },
  /** Подпись полосы вкладок для экранного диктора */
  tabsLabel: 'Tabular sections',
  keysHint: '↑ ↓ change the number (Shift — by 10) · Enter next row · Insert new line',
  tabs: {
    lines: 'Products and services',
    works: 'Works',
    materials: 'Materials',
    resources: 'Resources',
    assignees: 'Assignees',
    composition: 'Composition',
    billing: 'Billing breakdown',
    products: 'Products',
    disassembled: 'What we disassemble',
    bom: 'Bill of materials',
    outputs: 'Outputs',
    operations: 'Operations',
    releases: 'Releases',
    planLines: 'Plan lines',
    planVsFact: 'Plan vs fact',
    needs: 'Needs',
  },
};
