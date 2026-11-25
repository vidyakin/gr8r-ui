ALTER TABLE warehouses ADD COLUMN use_bins boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE warehouse_bins (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL DEFAULT '',
  zone text NOT NULL DEFAULT '',
  rack text NOT NULL DEFAULT '',
  shelf text NOT NULL DEFAULT '',
  cell text NOT NULL DEFAULT '',
  parent_id uuid,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT warehouse_bins_ws_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT warehouse_bins_warehouse_id_uq UNIQUE (workspace_id, warehouse_id, id),
  CONSTRAINT warehouse_bins_code_uq UNIQUE (workspace_id, warehouse_id, code),
  CONSTRAINT warehouse_bins_warehouse_fk FOREIGN KEY (workspace_id, warehouse_id) REFERENCES warehouses (workspace_id, id),
  CONSTRAINT warehouse_bins_parent_fk FOREIGN KEY (workspace_id, warehouse_id, parent_id) REFERENCES warehouse_bins (workspace_id, warehouse_id, id),
  CONSTRAINT warehouse_bins_code_chk CHECK (length(btrim(code)) BETWEEN 1 AND 64),
  CONSTRAINT warehouse_bins_parent_chk CHECK (parent_id <> id)
);
--> statement-breakpoint
CREATE TABLE stock_bin_balances (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL,
  bin_id uuid NOT NULL,
  product_id uuid NOT NULL,
  qty numeric(18,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, warehouse_id, bin_id, product_id),
  CONSTRAINT stock_bin_balances_bin_fk FOREIGN KEY (workspace_id, warehouse_id, bin_id) REFERENCES warehouse_bins (workspace_id, warehouse_id, id),
  CONSTRAINT stock_bin_balances_product_fk FOREIGN KEY (workspace_id, product_id) REFERENCES products (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX stock_bin_balances_product_idx ON stock_bin_balances (workspace_id, warehouse_id, product_id);
--> statement-breakpoint
ALTER TABLE document_lines
  ADD COLUMN bin_id uuid,
  ADD COLUMN to_bin_id uuid,
  ADD COLUMN gtd_number text,
  ADD COLUMN origin_country text,
  ADD CONSTRAINT document_lines_bin_fk FOREIGN KEY (workspace_id, bin_id) REFERENCES warehouse_bins (workspace_id, id),
  ADD CONSTRAINT document_lines_to_bin_fk FOREIGN KEY (workspace_id, to_bin_id) REFERENCES warehouse_bins (workspace_id, id);
--> statement-breakpoint
ALTER TABLE stock_moves
  ADD COLUMN bin_id uuid,
  ADD COLUMN gtd_number text,
  ADD COLUMN origin_country text,
  ADD CONSTRAINT stock_moves_bin_fk FOREIGN KEY (workspace_id, warehouse_id, bin_id) REFERENCES warehouse_bins (workspace_id, warehouse_id, id);
--> statement-breakpoint
CREATE INDEX stock_moves_bin_idx ON stock_moves (workspace_id, warehouse_id, bin_id, product_id, seq) WHERE bin_id IS NOT NULL;
--> statement-breakpoint
SELECT app_secure_tenant_table('public.warehouse_bins'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.stock_bin_balances'::regclass);
