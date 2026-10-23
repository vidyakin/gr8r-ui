/* Тексты узлов сценария на текущем языке: название, описание и подписи параметров берутся из словаря
   automations.nodes.<тип> (точка в типе — «_»); нет перевода — английский текст из определения узла в @gr8r/shared */
import type { AnyNodeDef } from '@gr8r/shared';
import { hasKey, t } from '@/i18n';

const base = (type: string) => `automations.nodes.${type.replace(/\./g, '_')}`;
const tr = (key: string, fallback: string) => (hasKey(key) ? t(key) : fallback);

export const nodeLabel = (def: Pick<AnyNodeDef, 'type' | 'label'>) => tr(`${base(def.type)}.label`, def.label);
export const nodeDescription = (def: Pick<AnyNodeDef, 'type' | 'description'>) => tr(`${base(def.type)}.description`, def.description ?? '');
export const paramTitle = (type: string, key: string, fallback: string) => tr(`${base(type)}.params.${key}`, fallback);
