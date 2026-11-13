/* Товар каталога, которым изделие учитывается на складе и продаётся: без него выпуск на склад невозможен */
import * as React from 'react';
import { X } from 'lucide-react';
import { Button, IconButton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useProduct, useProductMutations, type Product } from '../catalog/data';
import { ProductField } from '../docs/position-field';
import { useProductionMutations, type Item } from './data';

/** Создать товар каталога по реквизитам изделия (название, код, единица) */
export function useCreateProductFor() {
  const pm = useProductMutations();
  return (v: { name: string; code: string; unitCode: string }) => pm.create.mutateAsync({ kind: 'goods', name: v.name, sku: v.code, unitCode: v.unitCode }) as Promise<Product>;
}

/** Поле «Товар в каталоге» карточки изделия: подбор, создание по изделию, отвязка */
export function ItemProductField({ item, canWrite }: { item: Item; canWrite: boolean }) {
  const t = useT();
  const m = useProductionMutations();
  const product = useProduct(item.productId ?? undefined);
  const create = useCreateProductFor();
  const [busy, setBusy] = React.useState(false);
  const link = (productId: string | null) => m.updateItem.mutate({ id: item.id, patch: { productId } });
  return (
    <div className="row" style={{ gap: 4, minWidth: 0 }}>
      <ProductField
        id={item.productId}
        name={product.data?.name ?? ''}
        productKind="goods"
        disabled={!canWrite}
        aria-label={t('production.item.catalogProduct')}
        placeholder={t('production.item.noCatalogProduct')}
        invalid={!item.productId}
        onPick={p => link(p.id)}
      />
      {canWrite && !item.productId && (
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const p = await create(item);
              link(p.id);
              toast(t('production.item.productCreated', { name: p.name }));
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('production.item.createProduct')}
        </Button>
      )}
      {canWrite && item.productId && (
        <IconButton size="sm" label={t('production.item.unlinkProduct')} onClick={() => link(null)}>
          <X size={13} />
        </IconButton>
      )}
    </div>
  );
}
