import hash from 'object-hash';
import Model, {ModelClass} from './Model';
import Query from './Query';

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
//     'Post:1:author': 'Author:1',
//     'Post:1:comments': ['Comment:1', 'Comment:2'],
//     'Post:2:author': 'Author:1',
//     'Post:2:comments': ['Comment:3', 'Comment:4'],
//     'Comment:1:post': 'Post:1',
//     'Comment:1:author': 'Author:2',
//     'Comment:2:post': 'Post:1',
//     'Comment:2:author': 'Author:3',
//     'Comment:3:post': 'Post:2',
//     'Comment:3:author': 'Author:2',
//     'Comment:4:post': 'Post:2',
//     'Comment:4:author': 'Author:3',
//     'Author:1:posts': ['Post:1', 'Post:2'],
//     'Author:1:comments': [],
//     'Author:2:posts': [],
//     'Author:2:comments': ['Comment:1', 'Comment:2'3,
//     'Author:3:posts': [],
//     'Author:3:comments': ['Comment:2', 'Comment:4'],
//   }
//
// queries:
//   {
//     'Post:<hash1>': Query<Post>({options: {...}, models: [...], ...}),
//     'Post:<hash2>': Query<Post>({options: {...}, models: [...], ...}),
//   }
//
// results:
//   {
//     'Post:1': {'Post:<hash1>': true},
//     'Post:2': {'Post:<hash1>': true},
//     'Post:3': {'Post:<hash1>': true},
//     'Post:10': {'Post:<hash2>': true},
//     'Post:11': {'Post:<hash2>': true},
//     'Post:12': {'Post:<hash2>': true},
//   }

interface ModelMap {
  [key: string]: Model;
}

interface QueryMap {
  [key: string]: Query<Model>;
}

interface RelationMap {
  [key: string]: string[] | string | null;
}

interface ResultMap {
  [key: string]: {[key: string]: true};
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

type MapperResult =
  | {
      type: 'fetch:success';
      modelClass: ModelClass<any>;
      record: Record<string, any>;
    }
  | {
      type: 'fetch:error';
      modelClass: ModelClass<any>;
      id: number | string;
      error: string;
    };

export type MapperAction = () => Promise<MapperResult>;

export default class Repo {
  constructor(
    private models: ModelMap = {},
    private relations: RelationMap = {},
    private queries: QueryMap = {},
    private results: ResultMap = {},
  ) {}

  loadQuery<M extends Model>(
    modelClass: ModelClass<M>,
    options: Record<string, unknown>,
    records: Record<string, unknown>[],
    paging?: {page: number; pageSize: number; count: number},
  ): Repo {
    let repo = this.load(modelClass, records);
    const loadedModels = records.map(
      r => repo.getModel(modelClass, r.id as M['id'])!,
    );

    const queries = {...this.queries};
    const results = {...this.results};

    const queryId = `${modelClass.name}:${hash(options)}`;
    let query = this.queries[queryId] as Query<M>;

    if (!query) {
      let models = loadedModels;

      if (paging) {
        models = [];
        models.length = paging.count;
        models.splice(
          paging.page * paging.pageSize,
          loadedModels.length,
          ...loadedModels,
        );
      }

      query = new Query(modelClass, {
        state: 'loaded',
        options,
        pageSize: paging?.pageSize,
        models,
      });
    } else {
      let models: (M | undefined)[] = loadedModels;

      if (paging) {
        models = query.models.slice();
        models.splice(
          paging.page * paging.pageSize,
          loadedModels.length,
          ...loadedModels,
        );
      }

      query = query.update({state: 'loaded', models});
    }

    queries[queryId] = query;

    for (const model of loadedModels) {
      results[model.key] = results[model.key] || {};
      results[model.key][queryId] = true;
    }

    return new Repo(repo.models, repo.relations, queries, results);
  }

  // Loads the given records into the repo.
  load<M extends Model>(
    klass: ModelClass<M>,
    records: Record<string, unknown> | Record<string, unknown>[],
    {
      state = 'loaded',
      errors = {},
    }: {state?: Model['state']; errors?: Model['errors']} = {},
  ): Repo {
    const models = {...this.models};
    const relations = {...this.relations};
    const queries = {...this.queries};
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

      if (model) {
        model = model.update({
          state,
          attributes: {...model.attributes, ...record},
          errors,
        });
      } else {
        model = new modelClass({
          state,
          attributes: record,
          errors,
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

      if (this.results[model.key]) {
        for (const queryId of Object.keys(this.results[model.key])) {
          let query = queries[queryId];
          query = query.update({
            models: query.models.map(m => (m?.id === model!.id ? model! : m)),
          });
          queries[queryId] = query;
        }
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

    return new Repo(models, relations, queries, this.results);
  }

  getModel<M extends Model>(
    modelClass: ModelClass<M>,
    id: M['id'],
  ): M | undefined {
    return this.models[`${modelClass.name}|${id}`] as M;
  }

  getQuery<M extends Model>(
    modelClass: ModelClass<M>,
    options: Record<string, unknown>,
  ): Query<M> | undefined {
    const queryId = `${modelClass.name}:${hash(options)}`;
    return this.queries[queryId] as Query<M>;
  }

  fetch<M extends Model>(
    modelClass: ModelClass<M>,
    id: M['id'],
    options?: Record<string, unknown>,
  ): [Repo, MapperAction] {
    const r = this.load(modelClass, {id}, {state: 'fetching'});
    const action = (): Promise<MapperResult> => {
      return modelClass.mapper.fetch(id, options).then(
        record => ({type: 'fetch:success', modelClass, record}),
        error => ({
          type: 'fetch:error',
          modelClass,
          id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    };
    return [r, action];
  }

  query<M extends Model>(
    modelClass: ModelClass<M>,
    options: Record<string, unknown>,
  ): this {
    return this;
  }

  processMapperResult(result: MapperResult): Repo {
    switch (result.type) {
      case 'fetch:success':
        return this.load(result.modelClass, result.record);
      case 'fetch:error':
        return this.load(
          result.modelClass,
          {id: result.id},
          {errors: {base: result.error}},
        );
    }
  }
}

// let r = new Repo();
// let a: RepoAction;
// [r, a] = r.fetch(Person, 1);
// a().then((result) => {
//   r = r.processResult(result);
// });
//
// class RepoActionExec {
//   constructor(public action: RepoAction) {}
//   exec(send: SendFn<Evt>) {
//     this.action().then((result) => {
//       send({type: 'REPO_ACTION_EXEC_RESULT', result});
//     });
//   }
// }
