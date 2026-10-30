ALTER TABLE "fleet_trips" ALTER COLUMN "vehicle_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_trips" ALTER COLUMN "driver_member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD COLUMN "hired" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- рейсы, уже отданные перевозчику, становятся наёмными: своих машины и водителей у них нет
UPDATE "fleet_trips" SET "hired" = true, "vehicle_id" = NULL, "driver_member_id" = NULL, "co_driver_member_id" = NULL WHERE "id" IN (SELECT "trip_id" FROM "fleet_trip_carriers");--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_transport_chk" CHECK (("fleet_trips"."hired" and "fleet_trips"."vehicle_id" is null and "fleet_trips"."driver_member_id" is null and "fleet_trips"."co_driver_member_id" is null) or (not "fleet_trips"."hired" and "fleet_trips"."vehicle_id" is not null and "fleet_trips"."driver_member_id" is not null));