CREATE TABLE IF NOT EXISTS users (
 telegram_id bigint PRIMARY KEY, name text NOT NULL, username text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workers (
 telegram_id bigint PRIMARY KEY, name text NOT NULL, role text NOT NULL CHECK(role IN ('instructor','rental')),
 active boolean NOT NULL DEFAULT true, ski boolean NOT NULL DEFAULT true, snowboard boolean NOT NULL DEFAULT true,
 commission_type text NOT NULL CHECK(commission_type IN ('fixed','percent')), commission_value integer NOT NULL CHECK(commission_value>=0 AND (commission_type='fixed' OR commission_value<=100)),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS services (
 id text PRIMARY KEY, name text NOT NULL, role text NOT NULL CHECK(role IN ('instructor','rental')),
 unit_price integer NOT NULL CHECK(unit_price>0), active boolean NOT NULL DEFAULT true
);
INSERT INTO services(id,name,role,unit_price) VALUES
 ('ski','Инструктор по лыжам','instructor',3000),('snowboard','Инструктор по сноуборду','instructor',3000),
 ('rent_ski','Прокат лыж','rental',1500),('rent_snowboard','Прокат сноуборда','rental',1500) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS bookings (
 id bigserial PRIMARY KEY, customer_id bigint NOT NULL REFERENCES users(telegram_id),
 service_id text NOT NULL REFERENCES services(id), service_name text NOT NULL, role text NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 quantity integer NOT NULL CHECK(quantity>0), duration integer NOT NULL CHECK(duration>0), details text NOT NULL,
 amount integer NOT NULL CHECK(amount>0), status text NOT NULL CHECK(status IN ('open','awaiting_payment','payment_review','confirmed','completed','cancelled','expired','refund_review','refunded')),
 worker_id bigint REFERENCES workers(telegram_id), worker_name text, commission_amount integer CHECK(commission_amount>=0), payout_amount integer CHECK(payout_amount>=0),
 paid_out_at timestamptz, deadline timestamptz, group_id bigint NOT NULL, group_message_id bigint,
 request_key text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_worker_time ON bookings(worker_id,starts_at,ends_at);
CREATE INDEX IF NOT EXISTS bookings_customer ON bookings(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_status_deadline ON bookings(status,deadline);
CREATE TABLE IF NOT EXISTS payments (
 booking_id bigint PRIMARY KEY REFERENCES bookings(id), provider text NOT NULL DEFAULT 'manual_qr', external_id text,
 amount integer NOT NULL CHECK(amount>0), status text NOT NULL CHECK(status IN ('pending','reported','verified','refund_review','refunded','closed')),
 proof_file_id text, reported_at timestamptz, verified_at timestamptz, refunded_at timestamptz
);
CREATE TABLE IF NOT EXISTS audit_log (
 id bigserial PRIMARY KEY, booking_id bigint REFERENCES bookings(id), actor text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outbox (
 id bigserial PRIMARY KEY, booking_id bigint NOT NULL REFERENCES bookings(id), kind text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, last_error text
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(available_at,id) WHERE sent_at IS NULL;
-- v0.2: additive migration; preserves existing orders and payments.
ALTER TABLE workers ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS registration_status text NOT NULL DEFAULT 'approved';
ALTER TABLE workers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS ski_price integer CHECK(ski_price>0);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS snowboard_price integer CHECK(snowboard_price>0);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS ski_child_price integer CHECK(ski_child_price>0);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS snowboard_child_price integer CHECK(snowboard_child_price>0);
ALTER TABLE services ADD COLUMN IF NOT EXISTS child_price integer CHECK(child_price>0);
UPDATE services SET child_price=unit_price WHERE child_price IS NULL;
UPDATE services SET active=false WHERE role='rental';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS child_rate boolean NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE TABLE IF NOT EXISTS instructor_registration (telegram_id bigint PRIMARY KEY, stage text NOT NULL, name text, updated_at timestamptz NOT NULL DEFAULT now());
