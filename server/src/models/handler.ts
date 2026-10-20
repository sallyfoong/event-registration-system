import { DataTypes, Model, Optional } from 'sequelize';
import { randomUUID } from 'crypto';

import { sequelize } from '../config/database';

const uuidPk = (): string => randomUUID();

export interface HandlerAttributes {
  uuid: string;
  name: string;
  email?: string | null;
}

// the attribute interface has to exist for the model generics, but every
// field is declared on the class itself
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HandlerCreationAttributes extends Optional<HandlerAttributes, 'uuid' | 'email'> {}

export class Handler
  extends Model<HandlerAttributes, HandlerCreationAttributes>
  implements HandlerAttributes
{
  // why declare instead of `name!: string`? With useDefineForClassFields on,
  // a plain field declaration emits an undefined assignment in the
  // constructor, clobbering the values Sequelize hydrates from dataValues.
  // The symptom is maddening: handler.uuid === undefined on a fetched row
  // while dataValues clearly holds it. declare adds types only, no runtime
  // assignment - the standard Sequelize + TS pattern.
  declare uuid: string;
  declare name: string;
  declare email?: string | null;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

Handler.init(
  {
    // UUID as the business PK; the auto-increment id never leaves the
    // system, so rows can't be enumerated
    uuid: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: () => uuidPk(),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: { msg: 'Please enter a name for this handler.' } },
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      // the seed uses email as the findOrCreate key, so format must be
      // rejected at write time
      validate: { isEmail: { msg: 'Please enter a valid email address for this handler.' } },
    },
  },
  {
    sequelize,
    tableName: 'handlers',
    timestamps: true,
    underscored: false,
  },
);
