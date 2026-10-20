import { DataTypes, Model, Optional } from 'sequelize';
import { randomUUID } from 'crypto';

import { sequelize } from '../config/database';

const uuidPk = (): string => randomUUID();

export interface EventAttributes {
  uuid: string;
  name: string;
  /** when the event starts */
  dateTime: Date;
  /** venue address, exactly as OneMap returned it for `postalCode` - the
   *  column is non-null because an event is never created without one */
  address: string;
  /** 6-digit Singapore postal code; the source of the address */
  postalCode: string;
  /** registration deadline; open only while now < deadline */
  deadline: Date;
  capacity: number;
  handlerUuid: string;
  /** not persisted; computed on the fly by a subquery during list queries,
   *  used only in returned DTOs */
  registrationCount?: number;
}

// the attribute interface has to exist for the model generics, but every
// field is declared on the class itself
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EventCreationAttributes extends Optional<
  EventAttributes,
  'uuid' | 'registrationCount'
> {}

export class Event
  extends Model<EventAttributes, EventCreationAttributes>
  implements EventAttributes
{
  // all declare - see handler.ts for why; plain field declarations overwrite
  // the values Sequelize hydrates from dataValues
  declare uuid: string;
  declare name: string;
  declare dateTime: Date;
  declare address: string;
  declare postalCode: string;
  declare deadline: Date;
  declare capacity: number;
  declare handlerUuid: string;
  declare registrationCount?: number;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

Event.init(
  {
    uuid: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: () => uuidPk(),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      // Unique, because the brief requires it: "The event name must be
      // unique." The uuid stays the identity for every URL, registration row
      // and foreign key - this index is a business rule on a label, not an
      // identity. The service also pre-checks, but only to produce a friendly
      // message; under concurrency two requests can both pass the pre-check,
      // and the index is what actually blocks the duplicate.
      unique: { name: 'events_name_unique', msg: 'An event with this name already exists.' },
      validate: {
        notEmpty: { msg: 'Please enter a name for the event.' },
        len: { args: [1, 255], msg: 'The event name needs to be between 1 and 255 characters.' },
      },
    },
    dateTime: {
      type: DataTypes.DATE,
      allowNull: false,
      // isDate needs an explicit message: Sequelize's default ("Validation
      // isDate on dateTime failed") is developer text that would otherwise be
      // shown to a user verbatim.
      validate: {
        isDate: { args: true, msg: 'Please choose a valid date and time for the event.' },
      },
    },
    address: {
      type: DataTypes.STRING(500),
      allowNull: false,
      validate: { notEmpty: { msg: 'Please enter the address of the venue.' } },
    },
    postalCode: {
      type: DataTypes.STRING(6),
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Please enter the postal code of the venue.' },
        // when OneMap is unavailable, this regex is the only postal code
        // correctness guarantee
        is: { args: /^\d{6}$/, msg: 'Please enter a 6-digit Singapore postal code.' },
      },
    },
    deadline: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: {
        isDate: {
          args: true,
          msg: 'Please choose a valid date and time for the registration deadline.',
        },
      },
    },
    capacity: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      validate: {
        isInt: { msg: 'Please enter a whole number for the capacity.' },
        // capacity 0 is meaningless as an event and would make the "open"
        // check permanently false
        min: { args: [1], msg: 'The capacity needs to be at least 1.' },
        // a 5-digit running number tops out at 99999 registrations; the
        // validator chain already enforces this, this duplicate guard
        // covers paths that write directly to the DB
        max: {
          args: [99999],
          msg: 'The capacity cannot be more than 99999, because registration numbers have 5 digits.',
        },
      },
    },
    handlerUuid: {
      type: DataTypes.UUID,
      allowNull: false,
      // RESTRICT: don't allow deleting a staff member who still owns events,
      // otherwise events point at a non-existent handler
      references: { model: 'handlers', key: 'uuid' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    registrationCount: {
      // VIRTUAL: no column, no persistence - just a slot to hang a computed
      // value on
      type: DataTypes.VIRTUAL,
    },
  },
  {
    sequelize,
    tableName: 'events',
    timestamps: true,
    underscored: false,
    indexes: [
      // one index per hot filter/join condition:
      // name, "is this handler taken", deadline checks.
      //
      // No plain index on name: the unique index declared on the column above
      // is already a B-tree on the same column, and MySQL will serve an exact
      // match or an ORDER BY from it. A second non-unique index would only add
      // a write to every insert and update.
      //
      // Neither index helps the admin search, which uses LIKE '%term%' - a
      // leading wildcard makes any B-tree unusable, so that query scans by
      // design. It is a search over a bounded admin list, not a user-facing
      // feed.
      { fields: ['handlerUuid'] },
      { fields: ['deadline'] },
    ],
  },
);
