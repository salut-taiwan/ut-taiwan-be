const {
  pgTable, uuid, text, varchar, integer, boolean, numeric,
  timestamp, jsonb, date, unique,
} = require('drizzle-orm/pg-core');
const { relations } = require('drizzle-orm');

// shorthand for timestamptz
const tsz = (name) => timestamp(name, { withTimezone: true });

// ─── Reference / Catalog ────────────────────────────────────────────────────

const faculties = pgTable('faculties', {
  id:          uuid('id').primaryKey().defaultRandom(),
  code:        varchar('code', { length: 20 }).unique().notNull(),
  name:        text('name').notNull(),
  description: text('description'),
  created_at:  tsz('created_at').defaultNow(),
  updated_at:  tsz('updated_at').defaultNow(),
});

const programs = pgTable('programs', {
  id:         uuid('id').primaryKey().defaultRandom(),
  faculty_id: uuid('faculty_id').references(() => faculties.id, { onDelete: 'cascade' }),
  code:       varchar('code', { length: 20 }).unique().notNull(),
  name:       text('name').notNull(),
  level:      varchar('level', { length: 10 }).notNull(), // D3 | D4 | S1
  total_sks:  integer('total_sks'),
  created_at: tsz('created_at').defaultNow(),
  updated_at: tsz('updated_at').defaultNow(),
});

const subjects = pgTable('subjects', {
  id:            uuid('id').primaryKey().defaultRandom(),
  program_id:    uuid('program_id').references(() => programs.id, { onDelete: 'cascade' }),
  code:          varchar('code', { length: 20 }).notNull(),
  name:          text('name').notNull(),
  sks:           integer('sks').notNull(),
  exam_period:   varchar('exam_period', { length: 10 }),
  semester_hint: integer('semester_hint'), // 1–9
  notes:         text('notes'),
  is_required:   boolean('is_required').default(true),
  created_at:    tsz('created_at').defaultNow(),
  updated_at:    tsz('updated_at').defaultNow(),
}, (t) => [unique().on(t.program_id, t.code)]);

const modules = pgTable('modules', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tbo_code:        varchar('tbo_code', { length: 30 }).unique().notNull(),
  name:            text('name').notNull(),
  edition:         varchar('edition', { length: 20 }),
  author:          text('author'),
  publisher:       text('publisher').default('Universitas Terbuka'),
  cover_image_url: text('cover_image_url'),
  price_student:   numeric('price_student', { precision: 12, scale: 2 }),
  price_general:   numeric('price_general', { precision: 12, scale: 2 }),
  weight_grams:    integer('weight_grams'),
  is_available:    boolean('is_available').default(true),
  tbo_url:         text('tbo_url'),
  has_multimedia:  boolean('has_multimedia').default(false),
  first_seen_at:   tsz('first_seen_at').defaultNow(),
  last_seen_at:    tsz('last_seen_at').defaultNow(),
  deleted_at:      tsz('deleted_at'),
  created_at:      tsz('created_at').defaultNow(),
  updated_at:      tsz('updated_at').defaultNow(),
});

const subject_modules = pgTable('subject_modules', {
  id:         uuid('id').primaryKey().defaultRandom(),
  subject_id: uuid('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
  module_id:  uuid('module_id').references(() => modules.id, { onDelete: 'cascade' }),
  sort_order: integer('sort_order').default(0),
  created_at: tsz('created_at').defaultNow(),
}, (t) => [unique().on(t.subject_id, t.module_id)]);

const packages = pgTable('packages', {
  id:          uuid('id').primaryKey().defaultRandom(),
  program_id:  uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
  name:        text('name').notNull(),
  description: text('description'),
  semester:    integer('semester'), // 1–9
  is_active:   boolean('is_active').default(true),
  created_at:  tsz('created_at').defaultNow(),
  updated_at:  tsz('updated_at').defaultNow(),
});

const package_modules = pgTable('package_modules', {
  id:         uuid('id').primaryKey().defaultRandom(),
  package_id: uuid('package_id').references(() => packages.id, { onDelete: 'cascade' }),
  module_id:  uuid('module_id').references(() => modules.id, { onDelete: 'cascade' }),
  sort_order: integer('sort_order').default(0),
}, (t) => [unique().on(t.package_id, t.module_id)]);

// ─── Scraper ────────────────────────────────────────────────────────────────

const scraper_runs = pgTable('scraper_runs', {
  id:              uuid('id').primaryKey().defaultRandom(),
  started_at:      tsz('started_at').defaultNow(),
  finished_at:     tsz('finished_at'),
  status:          varchar('status', { length: 20 }).default('running'), // running | success | failed
  modules_added:   integer('modules_added').default(0),
  modules_updated: integer('modules_updated').default(0),
  modules_removed: integer('modules_removed').default(0),
  error_message:   text('error_message'),
  triggered_by:    varchar('triggered_by', { length: 20 }).default('cron'), // cron | manual
});

const module_history = pgTable('module_history', {
  id:             uuid('id').primaryKey().defaultRandom(),
  module_id:      uuid('module_id').references(() => modules.id, { onDelete: 'cascade' }),
  scraper_run_id: uuid('scraper_run_id').references(() => scraper_runs.id),
  change_type:    varchar('change_type', { length: 20 }).notNull(), // added | updated | removed
  old_data:       jsonb('old_data'),
  new_data:       jsonb('new_data'),
  changed_at:     tsz('changed_at').defaultNow(),
});

// ─── Users ──────────────────────────────────────────────────────────────────

const users = pgTable('users', {
  id:               uuid('id').primaryKey(),                            // FK to auth.users
  email:            text('email').unique().notNull(),
  name:             text('name').notNull(),
  nim:              varchar('nim', { length: 20 }),
  phone:            text('phone'),
  program_id:       uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
  current_semester: integer('current_semester'),                        // 1–9
  shipping_address: text('shipping_address'),
  city:             text('city'),
  province:         text('province'),
  postal_code:      varchar('postal_code', { length: 10 }),
  country:          text('country').default('Taiwan'),
  role:             varchar('role', { length: 20 }).default('student'), // student | admin
  is_verified:      boolean('is_verified').default(false),
  // bank fields (migration 006)
  bank_ntd_code:    text('bank_ntd_code'),
  bank_ntd_name:    text('bank_ntd_name'),
  bank_ntd_account: text('bank_ntd_account'),
  bank_idr_name:    text('bank_idr_name'),
  bank_idr_account: text('bank_idr_account'),
  // birth fields (migration 007)
  birth_place:      text('birth_place'),
  birth_date:       date('birth_date'),
  // Taiwan address in Mandarin (migration 008)
  address_zh_city:     text('address_zh_city'),
  address_zh_district: text('address_zh_district'),
  address_zh_road:     text('address_zh_road'),
  address_zh_number:   text('address_zh_number'),
  address_zh_floor:    text('address_zh_floor'),
  // SALUT membership (migrations 015, 018)
  is_salut:                  boolean('is_salut').default(false).notNull(),
  salut_status:              text('salut_status').default('none').notNull(), // none | pending | approved | rejected
  salut_applied_at:          tsz('salut_applied_at'),
  salut_payment_proof_url:   text('salut_payment_proof_url'),
  salut_rejection_reason:    text('salut_rejection_reason'),
  salut_approved_at:         tsz('salut_approved_at'),
  created_at: tsz('created_at').defaultNow(),
  updated_at: tsz('updated_at').defaultNow(),
});

// ─── Cart ────────────────────────────────────────────────────────────────────

const carts = pgTable('carts', {
  id:         uuid('id').primaryKey().defaultRandom(),
  user_id:    uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).unique(),
  created_at: tsz('created_at').defaultNow(),
  updated_at: tsz('updated_at').defaultNow(),
});

const cart_items = pgTable('cart_items', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  cart_id:              uuid('cart_id').references(() => carts.id, { onDelete: 'cascade' }),
  module_id:            uuid('module_id').references(() => modules.id, { onDelete: 'cascade' }),
  sku_id:               uuid('sku_id'),                                 // FK to product_skus (forward ref)
  quantity:             integer('quantity').notNull().default(1),
  price_snapshot:       numeric('price_snapshot', { precision: 12, scale: 2 }).notNull(),
  is_request:           boolean('is_request').notNull().default(false),
  variant_label:        text('variant_label'),
  product_name_snapshot: text('product_name_snapshot'),
  added_at:             tsz('added_at').defaultNow(),
  // DB-level: UNIQUE(cart_id, module_id) and UNIQUE(cart_id, sku_id) enforced in Postgres
  // DB-level: CHECK (module_id IS NOT NULL) != (sku_id IS NOT NULL)
});

// ─── Merchandise ─────────────────────────────────────────────────────────────

const products = pgTable('products', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tokopedia_id: varchar('tokopedia_id', { length: 50 }).unique(),
  category:     varchar('category', { length: 50 }).notNull(),
  name:         text('name').notNull(),
  description:  text('description'),
  base_price:   numeric('base_price', { precision: 12, scale: 2 }).notNull(),
  weight_grams: integer('weight_grams').notNull().default(0),
  created_at:   tsz('created_at').defaultNow(),
  updated_at:   tsz('updated_at').defaultNow(),
});

const product_images = pgTable('product_images', {
  id:         uuid('id').primaryKey().defaultRandom(),
  product_id: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  image_url:  text('image_url').notNull(),
  sort_order: integer('sort_order').notNull().default(0),
});

const product_variant_types = pgTable('product_variant_types', {
  id:         uuid('id').primaryKey().defaultRandom(),
  product_id: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  name:       varchar('name', { length: 100 }).notNull(),
  identifier: varchar('identifier', { length: 50 }).notNull(),
  sort_order: integer('sort_order').notNull().default(0),
});

const product_variant_options = pgTable('product_variant_options', {
  id:              uuid('id').primaryKey().defaultRandom(),
  variant_type_id: uuid('variant_type_id').references(() => product_variant_types.id, { onDelete: 'cascade' }).notNull(),
  value:           varchar('value', { length: 100 }).notNull(),
  hex_color:       varchar('hex_color', { length: 7 }),
  sort_order:      integer('sort_order').notNull().default(0),
});

const product_skus = pgTable('product_skus', {
  id:               uuid('id').primaryKey().defaultRandom(),
  product_id:       uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  tokopedia_sku_id: varchar('tokopedia_sku_id', { length: 50 }),
  price:            numeric('price', { precision: 12, scale: 2 }).notNull(),
  option_names:     jsonb('option_names').notNull().default([]),
  created_at:       tsz('created_at').defaultNow(),
  updated_at:       tsz('updated_at').defaultNow(),
});

// ─── Orders ──────────────────────────────────────────────────────────────────

const orders = pgTable('orders', {
  id:               uuid('id').primaryKey().defaultRandom(),
  order_number:     varchar('order_number', { length: 30 }).unique().notNull(),
  user_id:          uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  status:           varchar('status', { length: 30 }).default('pending'),
  // pending | awaiting_payment | paid | processing | shipped | delivered | cancelled
  subtotal:         numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
  shipping_cost:    numeric('shipping_cost', { precision: 12, scale: 2 }).default('0'),
  box_fee:          numeric('box_fee', { precision: 12, scale: 2 }).notNull().default('0'),
  admin_fee:        numeric('admin_fee', { precision: 12, scale: 2 }).notNull().default('0'),
  is_salut_order:   boolean('is_salut_order').notNull().default(false),
  total_amount:     numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
  shipping_name:    text('shipping_name'),
  shipping_address: text('shipping_address'),
  shipping_city:    text('shipping_city'),
  shipping_province: text('shipping_province'),
  shipping_postal:  varchar('shipping_postal', { length: 10 }),
  shipping_country: text('shipping_country'),
  shipping_phone:   text('shipping_phone'),
  notes:            text('notes'),
  shipped_at:       tsz('shipped_at'),
  created_at:       tsz('created_at').defaultNow(),
  updated_at:       tsz('updated_at').defaultNow(),
});

const order_items = pgTable('order_items', {
  id:             uuid('id').primaryKey().defaultRandom(),
  order_id:       uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
  module_id:      uuid('module_id').references(() => modules.id, { onDelete: 'set null' }),
  sku_id:         uuid('sku_id').references(() => product_skus.id),
  module_code:    varchar('module_code', { length: 30 }),               // nullable for merch items
  module_name:    text('module_name').notNull(),
  quantity:       integer('quantity').notNull().default(1),
  unit_price:     numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  subtotal:       numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
  is_request:     boolean('is_request').notNull().default(false),
  request_status: text('request_status'),                               // pending | approved | rejected | null
  variant_label:  text('variant_label'),
});

const payments = pgTable('payments', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  order_id:           uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
  gateway:            varchar('gateway', { length: 30 }),               // midtrans | xendit | manual
  gateway_payment_id: text('gateway_payment_id'),
  gateway_billing_no: text('gateway_billing_no'),
  method:             varchar('method', { length: 30 }),
  bank:               varchar('bank', { length: 20 }),
  amount:             numeric('amount', { precision: 12, scale: 2 }).notNull(),
  unique_code:        integer('unique_code').default(0),
  status:             varchar('status', { length: 20 }).default('pending'),
  // pending | paid | expired | failed | refunded
  paid_at:            tsz('paid_at'),
  expires_at:         tsz('expires_at'),
  gateway_response:   jsonb('gateway_response'),
  proof_path:         text('proof_path'),
  invoice_path:       text('invoice_path'),
  proof_uploaded_at:  tsz('proof_uploaded_at'),
  created_at:         tsz('created_at').defaultNow(),
  updated_at:         tsz('updated_at').defaultNow(),
});

// ─── Relations (for relational query API) ────────────────────────────────────

const facultiesRelations = relations(faculties, ({ many }) => ({
  programs: many(programs),
}));

const programsRelations = relations(programs, ({ one, many }) => ({
  faculties: one(faculties, { fields: [programs.faculty_id], references: [faculties.id] }),
  subjects:  many(subjects),
  packages:  many(packages),
}));

const subjectsRelations = relations(subjects, ({ one, many }) => ({
  programs:        one(programs, { fields: [subjects.program_id], references: [programs.id] }),
  subject_modules: many(subject_modules),
}));

const modulesRelations = relations(modules, ({ many }) => ({
  subject_modules: many(subject_modules),
  package_modules: many(package_modules),
  order_items:     many(order_items),
}));

const subjectModulesRelations = relations(subject_modules, ({ one }) => ({
  subjects: one(subjects, { fields: [subject_modules.subject_id], references: [subjects.id] }),
  modules:  one(modules,  { fields: [subject_modules.module_id],  references: [modules.id]  }),
}));

const packagesRelations = relations(packages, ({ one, many }) => ({
  programs:        one(programs, { fields: [packages.program_id], references: [programs.id] }),
  package_modules: many(package_modules),
}));

const packageModulesRelations = relations(package_modules, ({ one }) => ({
  packages: one(packages, { fields: [package_modules.package_id], references: [packages.id] }),
  modules:  one(modules,  { fields: [package_modules.module_id],  references: [modules.id]  }),
}));

const usersRelations = relations(users, ({ one, many }) => ({
  programs: one(programs, { fields: [users.program_id], references: [programs.id] }),
  carts:    many(carts),
  orders:   many(orders),
}));

const cartsRelations = relations(carts, ({ one, many }) => ({
  users:      one(users, { fields: [carts.user_id], references: [users.id] }),
  cart_items: many(cart_items),
}));

const cartItemsRelations = relations(cart_items, ({ one }) => ({
  carts:        one(carts,        { fields: [cart_items.cart_id],   references: [carts.id]        }),
  modules:      one(modules,      { fields: [cart_items.module_id], references: [modules.id]      }),
  product_skus: one(product_skus, { fields: [cart_items.sku_id],    references: [product_skus.id] }),
}));

const ordersRelations = relations(orders, ({ one, many }) => ({
  users:       one(users, { fields: [orders.user_id], references: [users.id] }),
  order_items: many(order_items),
  payments:    many(payments),
}));

const orderItemsRelations = relations(order_items, ({ one }) => ({
  orders:       one(orders,        { fields: [order_items.order_id],  references: [orders.id]        }),
  modules:      one(modules,       { fields: [order_items.module_id], references: [modules.id]       }),
  product_skus: one(product_skus,  { fields: [order_items.sku_id],    references: [product_skus.id]  }),
}));

const paymentsRelations = relations(payments, ({ one }) => ({
  orders: one(orders, { fields: [payments.order_id], references: [orders.id] }),
}));

const productsRelations = relations(products, ({ many }) => ({
  product_images:        many(product_images),
  product_variant_types: many(product_variant_types),
  product_skus:          many(product_skus),
}));

const productImagesRelations = relations(product_images, ({ one }) => ({
  products: one(products, { fields: [product_images.product_id], references: [products.id] }),
}));

const productVariantTypesRelations = relations(product_variant_types, ({ one, many }) => ({
  products:                one(products, { fields: [product_variant_types.product_id], references: [products.id] }),
  product_variant_options: many(product_variant_options),
}));

const productVariantOptionsRelations = relations(product_variant_options, ({ one }) => ({
  product_variant_types: one(product_variant_types, { fields: [product_variant_options.variant_type_id], references: [product_variant_types.id] }),
}));

const productSkusRelations = relations(product_skus, ({ one, many }) => ({
  products:    one(products, { fields: [product_skus.product_id], references: [products.id] }),
  cart_items:  many(cart_items),
  order_items: many(order_items),
}));

const scraperRunsRelations = relations(scraper_runs, ({ many }) => ({
  module_history: many(module_history),
}));

const moduleHistoryRelations = relations(module_history, ({ one }) => ({
  modules:      one(modules,      { fields: [module_history.module_id],      references: [modules.id]      }),
  scraper_runs: one(scraper_runs, { fields: [module_history.scraper_run_id], references: [scraper_runs.id] }),
}));

module.exports = {
  // tables
  faculties,
  programs,
  subjects,
  modules,
  subject_modules,
  packages,
  package_modules,
  scraper_runs,
  module_history,
  users,
  carts,
  cart_items,
  products,
  product_images,
  product_variant_types,
  product_variant_options,
  product_skus,
  orders,
  order_items,
  payments,
  // relations
  facultiesRelations,
  programsRelations,
  subjectsRelations,
  modulesRelations,
  subjectModulesRelations,
  packagesRelations,
  packageModulesRelations,
  usersRelations,
  cartsRelations,
  cartItemsRelations,
  ordersRelations,
  orderItemsRelations,
  paymentsRelations,
  productsRelations,
  productImagesRelations,
  productVariantTypesRelations,
  productVariantOptionsRelations,
  productSkusRelations,
  scraperRunsRelations,
  moduleHistoryRelations,
};
