import { Handler } from './handler';
import { Event } from './event';
import { Registration } from './registration';

// associations are declared here, once, and must run before any query.
// A separate file (rather than inside each model) avoids circular imports:
// event.ts needs types from handler.ts, and someone has to wire both
// together after the fact.
//
// the `as` aliases are load-bearing for the query layer:
// include({ model: Handler, as: 'handler' }) and the '$handler.name$'
// search condition both depend on as: 'handler' - renaming it silently
// breaks the search.

// Handler 1 --- * Event
// one handler can own multiple events (at most one OPEN at a time - that
// rule lives in the service)
Handler.hasMany(Event, {
  foreignKey: 'handlerUuid',
  sourceKey: 'uuid',
  as: 'events',
  onDelete: 'RESTRICT',
});
Event.belongsTo(Handler, {
  foreignKey: 'handlerUuid',
  targetKey: 'uuid',
  as: 'handler',
});

// Event 1 --- * Registration
// registrations have no meaning without their event, hence the cascade
Event.hasMany(Registration, {
  foreignKey: 'eventUuid',
  sourceKey: 'uuid',
  as: 'registrations',
  onDelete: 'CASCADE',
});
Registration.belongsTo(Event, {
  foreignKey: 'eventUuid',
  targetKey: 'uuid',
  as: 'event',
});

export { Handler, Event, Registration };
export * from './handler';
export * from './event';
export * from './registration';
