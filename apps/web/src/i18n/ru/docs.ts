/* Формы документов: вкладки табличных частей (как в 1С), подсказки клавиш, комментарий внизу */
export const docs = {
  comment: 'Комментарий',
  commentHint: {
    document: 'Внутренняя заметка или условия оплаты',
    productionOrder: 'Для чего этот заказ',
    otherCosts: 'На что эти затраты',
  },
  /** Подпись полосы вкладок для экранного диктора */
  tabsLabel: 'Табличные части',
  keysHint: '↑ ↓ меняют число (с Shift — на 10) · Enter — следующая строка · Insert — новая строка',
  tabs: {
    lines: 'Товары и услуги',
    works: 'Работы',
    materials: 'Материалы',
    resources: 'Ресурсы',
    assignees: 'Исполнители',
    composition: 'Состав',
    billing: 'Расшифровка биллинга',
    products: 'Продукция',
    disassembled: 'Что разбираем',
    bom: 'Спецификация',
    outputs: 'Выходные продукты',
    operations: 'Операции',
    releases: 'Выпуски',
    planLines: 'Строки плана',
    planVsFact: 'План и факт',
    needs: 'Потребности',
  },
};
