import Model, {ModelClass} from './Model';

// models:
//   {
//     'Post:1': Post({id: 1, ...}),
//     'Post:2': Post({id: 2, ...}),
//     'Comment:1': Comment({id: 1, ...}),
//     'Comment:2': Comment({id: 2, ...}),
//     'Comment:3': Comment({id: 3, ...}),
//     'Comment:4': Comment({id: 4, ...}),
//     'Author:1': Author({id: 1, ...}),
//     'Author:2': Author({id: 2, ...}),
//     'Author:3': Author({id: 3, ...}),
//   }
//
// relations:
//   {
//     'Post:1': {
//       author: 'Author:1',
//       comments: ['Comment:1', 'Comment:2']
//     },
//     'Post:2': {
//       author: 'Author:1',
//       comments: ['Comment:3', 'Comment:4']
//     },
//     'Comment:1': {
//       post: 'Post:1',
//       author: 'Author:2',
//     },
//     'Comment:2': {
//       post: 'Post:1',
//       author: 'Author:3',
//     },
//     'Comment:3': {
//       post: 'Post:2',
//       author: 'Author:2',
//     },
//     'Comment:4': {
//       post: 'Post:2',
//       author: 'Author:3',
//     },
//     'Author:1': {
//       posts: ['Post:1', 'Post:2'],
//       comments: [],
//     },
//     'Author:2': {
//       posts: [],
//       comments: ['Comment:1', 'Comment:2'3,
//     },
//     'Author:3': {
//       posts: [],
//       comments: ['Comment:2', 'Comment:4'],
//     },
//   }

interface ModelMap {
  [key: string]: Model;
}

interface RelationMap {
  [key: string]: string[] | string | null;
}

type Loadable = {id: string | number};

const isLoadable = (x: any): x is Loadable => {
  if (
    typeof x === 'object' &&
    'id' in x &&
    (typeof x.id === 'number' || typeof x === 'string')
  ) {
    return true;
  }
  return false;
};

export default class Repo {
  constructor(
    private models: ModelMap = {},
    private relations: RelationMap = {},
  ) {}

  // Loads the given records into the repo.
  //
  // Two passes:
  //   first pass:
  //     upsert received record and related records
  //     update relations as we go
  //   second pass:
  //     for each upserted record, traverse relations, updating model references
  //
  // Upsert model for each record
  // Upsert model for each detected related record
  //
  //
  load<M extends Model>(
    klass: ModelClass<M>,
    records: Record<string, unknown> | Record<string, unknown>[],
  ): Repo {
    const models = {...this.models};
    const relations = {...this.relations};
    const updated: {[key: string]: Model} = {};

    const queue = Array.isArray(records)
      ? records.map(r => ({modelClass: klass, record: r}))
      : [{modelClass: klass, record: records}];
    let item: typeof queue[number] | undefined;

    while ((item = queue.shift())) {
      const {modelClass} = item;
      let {record} = item;

      if (!isLoadable(record)) {
        throw new Error(
          `Repo#load: received ${modelClass.name} record without an id`,
        );
      }

      const loadKey = `${modelClass.name}|${record.id}`;

      // process relations
      for (const relationName in modelClass.relations) {
        if (!(relationName in record)) continue;

        const relation = modelClass.relations[relationName];
        const relationKey = `${loadKey}|${relationName}`;
        const inverseRelation = relation.inverse
          ? relation.modelClass.relations[relation.inverse]
          : undefined;

        const {[relationName]: related, ...remaining} = record;
        record = remaining;

        // load related records
        switch (relation.cardinality) {
          case 'many':
            {
              if (!Array.isArray(related)) {
                throw new Error(
                  `Repo#load: ${modelClass.name}(${record.id}) to-many relation \`${relationName}\` is not an array`,
                );
              }

              // clear stale inverse relations
              if (inverseRelation && relations[relationKey]) {
                for (const relatedKey of relations[relationKey]!) {
                  const inverseRelationKey = `${relatedKey}|${relation.inverse}`;

                  if (!relations[inverseRelationKey]) continue;

                  switch (inverseRelation.cardinality) {
                    case 'many':
                      relations[inverseRelationKey] = (relations[
                        inverseRelationKey
                      ] as string[]).filter(k => k !== loadKey);
                      break;
                    case 'one':
                      relations[inverseRelationKey] = null;
                      break;
                  }
                }
              }

              const relatedKeys: string[] = [];

              for (const r of related) {
                if (isLoadable(r)) {
                  relatedKeys.push(`${relation.modelClass.name}|${r.id}`);
                  queue.push({
                    modelClass: relation.modelClass,
                    record: r,
                  });
                } else if (typeof r === 'number' || typeof r === 'string') {
                  relatedKeys.push(`${relation.modelClass.name}|${r}`);
                  queue.push({
                    modelClass: relation.modelClass,
                    record: {id: r},
                  });
                } else {
                  throw new Error(
                    `Repo#load: ${modelClass.name}(${record.id}) received unloadable to-many \`${relationName}\` record`,
                  );
                }
              }

              relations[relationKey] = relatedKeys;

              if (inverseRelation) {
                for (const relatedKey of relatedKeys) {
                  switch (inverseRelation.cardinality) {
                    case 'many':
                      relations[`${relatedKey}|${relation.inverse}`] =
                        relations[`${relatedKey}|${relation.inverse}`] || [];
                      (relations[
                        `${relatedKey}|${relation.inverse}`
                      ] as string[]).push(loadKey);
                      break;
                    case 'one':
                      relations[`${relatedKey}|${relation.inverse}`] = loadKey;
                      break;
                  }
                }
              }
            }
            break;
          case 'one':
            {
              // clear stale inverse relations
              if (inverseRelation && relations[relationKey]) {
                const relatedKey = relations[relationKey];
                const inverseRelationKey = `${relatedKey}|${relation.inverse}`;

                if (relations[inverseRelationKey]) {
                  switch (inverseRelation.cardinality) {
                    case 'many':
                      relations[inverseRelationKey] = (relations[
                        inverseRelationKey
                      ] as string[]).filter(k => k !== loadKey);
                      break;
                    case 'one':
                      relations[inverseRelationKey] = null;
                      break;
                  }
                }
              }

              let relatedKey: string | null = null;

              if (related === null) {
                relations[relationKey] = null;
              } else if (isLoadable(related)) {
                relatedKey = `${relation.modelClass.name}|${related.id}`;
                relations[relationKey] = relatedKey;
                queue.push({
                  modelClass: relation.modelClass,
                  record: related,
                });
              } else if (
                typeof related === 'string' ||
                typeof related === 'number'
              ) {
                relatedKey = `${relation.modelClass.name}|${related}`;
                relations[relationKey] = relatedKey;
                queue.push({
                  modelClass: relation.modelClass,
                  record: {id: related},
                });
              }

              if (inverseRelation && relatedKey) {
                switch (inverseRelation.cardinality) {
                  case 'many':
                    relations[`${relatedKey}|${relation.inverse}`] =
                      relations[`${relatedKey}|${relation.inverse}`] || [];
                    (relations[
                      `${relatedKey}|${relation.inverse}`
                    ] as string[]).push(loadKey);
                    break;
                  case 'one':
                    relations[`${relatedKey}|${relation.inverse}`] = loadKey;
                    break;
                }
              }
            }
            break;
        }
      }

      let model = models[loadKey];
      const empty = Object.keys(record).length === 1;

      if (model) {
        model = model.update({
          state: empty ? model.state : 'loaded',
          attributes: {...model.attributes, ...record},
        });
      } else {
        model = new modelClass({
          state: empty ? 'empty' : 'loaded',
          attributes: record,
          relations: {},
        });
      }

      models[loadKey] = updated[loadKey] = model;
    }

    const relationQueue = Object.values(updated);
    const processed: {[key: string]: true} = {};
    let model: Model | undefined;

    while ((model = relationQueue.shift())) {
      if (processed[model.key]) continue;
      processed[model.key] = true;

      if (!updated[model.key]) {
        model = models[model.key] = updated[model.key] = model.update();
      }

      for (const relationName in model.ctor.relations) {
        const relation = model.ctor.relations[relationName];

        switch (relation.cardinality) {
          case 'many':
            {
              const relatedKeys =
                relations[`${model.key}|${relationName}`] || [];
              const relatedModels: Model[] = [];
              for (const relatedKey of relatedKeys) {
                let relatedModel = models[relatedKey];
                if (!updated[relatedModel.key]) {
                  relatedModel = models[relatedModel.key] = updated[
                    relatedModel.key
                  ] = relatedModel.update();
                }
                relatedModels.push(relatedModel);
                relationQueue.push(relatedModel);
              }
              model.relations[relationName] = relatedModels;
            }
            break;
          case 'one':
            {
              const relatedKey =
                relations[`${model.key}|${relationName}`] || null;
              if (relatedKey) {
                let relatedModel = models[relatedKey as string];
                if (!updated[relatedModel.key]) {
                  relatedModel = models[relatedModel.key] = updated[
                    relatedModel.key
                  ] = relatedModel.update();
                }
                relationQueue.push(relatedModel);
                model.relations[relationName] = relatedModel;
              }
            }
            break;
        }
      }
    }

    return new Repo(models, relations);
  }

  getModel<M extends Model>(
    modelClass: ModelClass<M>,
    id: M['id'],
  ): M | undefined {
    return this.models[`${modelClass.name}|${id}`] as M;
  }
}
