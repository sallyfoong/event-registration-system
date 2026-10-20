import { literal, Op, WhereOptions } from 'sequelize';

// "Is this event still open?" gets answered in three places: the admin list
// filter, the create-event handler check, and the public dropdown. Writing
// the condition three times is how you end up with a list that says full
// while the dropdown still offers the slot, so it lives here and everyone
// imports it.
//
// The literals below only ever contain constant SQL. User input goes through
// Sequelize's parameter binding and never passes through this file.

/** Escape LIKE wildcards so a search for "50%" doesn't turn into a pattern. */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** Live registration count, inlined as a subquery.
 *
 *  Why not a registrationCount column on the events table? Every insert would
 *  have to update it, and the two writes can drift apart permanently if one
 *  of them fails. Counting the registrations rows is the source of truth and
 *  cannot go stale.
 *
 *  Why a subquery instead of a GROUP BY join? The list also returns a total
 *  for pagination, and a grouped count makes that harder to reason about.
 *
 *  The backticks around `Event` are the alias Sequelize gives the main table;
 *  both MySQL and SQLite accept them, so one SQL string works on both. */
const REGISTRATION_COUNT_SQL =
  '(SELECT COUNT(*) FROM registrations r WHERE r.eventUuid = `Event`.uuid)';

export const registrationCountLiteral = () => literal(REGISTRATION_COUNT_SQL);

/** Registered count is below capacity.
 *  Not exported on purpose: this is a part of openEventCondition, and a
 *  half-condition that can be used on its own is exactly how two call sites
 *  end up disagreeing about what "open" means. */
const hasAvailableCapacityLiteral = () =>
  literal(`(${REGISTRATION_COUNT_SQL}) < \`Event\`.capacity`);

/** The full "can people still register" check: deadline hasn't passed and
 *  there is room left.
 *
 *  All three callers use this one definition:
 *    admin list      where: { [Op.and]: openEventCondition() }
 *    handler check   where: { handlerUuid, [Op.and]: openEventCondition() }
 *    public list     where: { [Op.and]: openEventCondition() }
 *
 *  An array rather than a merged object, because Sequelize needs the array
 *  form to AND the two conditions together when OR is also in play. */
export const openEventCondition = (): WhereOptions[] => [
  { deadline: { [Op.gt]: new Date() } },
  hasAvailableCapacityLiteral(),
];
