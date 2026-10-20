import { DataTypes, Model, Optional, UniqueConstraintError } from 'sequelize';
import { randomUUID } from 'crypto';

import { sequelize } from '../config/database';

// a Registration is one signup. It carries the two hardest constraints in
// the system: one registration per email per event, and unique running
// numbers within an event. Neither is enforced by an `if` in the service -
// both are pushed down to database unique indexes, because there is always
// a window between a concurrent request's check and its write; only the
// index truly holds.

const uuidPk = (): string => randomUUID();

/** Name of the email uniqueness index.
 *  Pulled out because "which index was hit" must be matched by name:
 *  MySQL reports the index name (registrations_event_email_unique) in the
 *  error, not the column name (emailAddress). Defining the name once here
 *  means the index creation and the collision check can't drift apart. */
export const REGISTRATION_EMAIL_INDEX = 'registrations_event_email_unique';

export interface RegistrationAttributes {
  uuid: string;
  eventUuid: string;
  emailAddress: string;
  /** 5-digit running number within the event (e.g. 00001), not a global
   *  auto-increment */
  registrationNo: string;
}

// the attribute interface has to exist for the model generics, but every
// field is declared on the class itself
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RegistrationCreationAttributes extends Optional<
  RegistrationAttributes,
  'uuid' | 'registrationNo'
> {}

export class Registration
  extends Model<RegistrationAttributes, RegistrationCreationAttributes>
  implements RegistrationAttributes
{
  // declare instead of plain fields - see handler.ts
  declare uuid: string;
  declare eventUuid: string;
  declare emailAddress: string;
  declare registrationNo: string;

  // createdAt is the sole basis for trend statistics - "when did this
  // registration happen" lives entirely in this column
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

Registration.init(
  {
    uuid: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: () => uuidPk(),
      allowNull: false,
    },
    eventUuid: {
      type: DataTypes.UUID,
      allowNull: false,
      // CASCADE: registrations are meaningless without their event
      references: { model: 'events', key: 'uuid' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    emailAddress: {
      type: DataTypes.STRING(255),
      allowNull: false,
      // the service already trims + lowercases; this is a second guard
      // against direct writes that skip the service
      validate: {
        isEmail: { msg: 'Please enter a valid email address.' },
        notEmpty: { msg: 'Please enter an email address.' },
      },
    },
    registrationNo: {
      type: DataTypes.STRING(5),
      allowNull: false,
      // CHAR(5) rather than INT: the leading zeros in 00001 are for the
      // user. Storing a number loses them, and re-padding on display is
      // a conversion that eventually gets forgotten somewhere.
      validate: {
        notEmpty: { msg: 'A registration number is required.' },
        is: { args: /^\d{5}$/, msg: 'The registration number needs to be 5 digits.' },
      },
    },
  },
  {
    sequelize,
    tableName: 'registrations',
    timestamps: true,
    underscored: false,
    indexes: [
      // running number is unique per event. This index is the safety net
      // for the "count + 1" allocation: two requests computing the same
      // number means the second insert is rejected and the service retries.
      {
        fields: ['eventUuid', 'registrationNo'],
        unique: true,
        name: 'registrations_event_no_unique',
      },
      // one email per event. The final line of defense under concurrency.
      { fields: ['eventUuid', 'emailAddress'], unique: true, name: REGISTRATION_EMAIL_INDEX },
      // Serves three queries with one index: the capacity count, the
      // "next free number" count, and the trend query, which filters on
      // eventUuid and orders by createdAt. Leading with eventUuid means the
      // two count queries are served by the prefix, and the second column
      // turns the trend's sort into an index read instead of a filesort.
      //
      // No separate (eventUuid) index: both unique indexes above already
      // start with that column, so a single-column index on it would be a
      // third copy of the same prefix and nothing but write overhead.
      { fields: ['eventUuid', 'createdAt'], name: 'registrations_event_created_idx' },
    ],
  },
);

/** Whether a unique constraint violation is specifically "duplicate email".
 *
 *  The two dialects can't even agree on the type of `fields`, which is the
 *  entire reason this function exists:
 *    SQLite -> ['eventUuid', 'emailAddress']                array of columns
 *    MySQL  -> { registrations_event_email_unique: '...' }  index-name object
 *  MySQL gives the index name because our unique indexes are declared in the
 *  model options.indexes, which Sequelize's uniqueKeys doesn't track - it
 *  can't reverse-map to column names, so it falls back to the index name.
 *  Flattening both shapes into one set and matching against it handles both.
 *
 *  Don't sniff the message: MySQL's message is just "Validation error",
 *  which contains nothing.
 *  Don't re-query the DB either: the earlier findOne in the transaction has
 *  established a snapshot, and a row committed by someone else after that
 *  snapshot is invisible to a plain SELECT - we'd misread it as a number
 *  collision. */
export const isDuplicateEmailError = (error: unknown): boolean => {
  if (!(error instanceof UniqueConstraintError)) {
    return false;
  }
  // the type declaration says fields is Record<string, unknown>, but the
  // SQLite dialect actually stuffs an array in at runtime - branch on the
  // runtime shape, not the annotation.
  const fields = error.fields as unknown;
  const fieldKeys = Array.isArray(fields)
    ? fields.map((key) => String(key))
    : Object.keys((fields ?? {}) as Record<string, unknown>);
  const paths = (error.errors ?? []).map((item) => String(item.path ?? ''));
  return [...fieldKeys, ...paths].some(
    (key) => key === 'emailAddress' || key === REGISTRATION_EMAIL_INDEX,
  );
};
