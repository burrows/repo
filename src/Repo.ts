import hash from 'object-hash';
import Model, {RawRecord, Options, ModelClass, MapperError} from './Model';
import Query from './Query';

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

export type MapperResult =
  | {type: 'fetch:success'; modelClass: ModelClass<any>; record: RawRecord}
  | {
      type: 'fetch:error';
      modelClass: ModelClass<any>;
      id: number | string;
      error: string;
    }
  | {
      type: 'query:success';
      modelClass: ModelClass<any>;
      options: Options;
      records: RawRecord[];
      paging?: {page: number; pageSize: number; count: number};
    }
  | {
      type: 'query:error';
      modelClass: ModelClass<any>;
      options: Options;
      error: string;
    }
  | {type: 'create:success'; modelClass: ModelClass<any>; record: RawRecord}
  | {type: 'create:error'; model: Model}
  | {type: 'update:success'; modelClass: ModelClass<any>; record: RawRecord}
  | {type: 'update:error'; model: Model}
  | {type: 'delete:success'; modelClass: ModelClass<any>; record: RawRecord}
  | {type: 'delete:error'; model: Model};

export type MapperAction = () => Promise<MapperResult>;

export default class Repo {
  constructor(
    private models: ModelMap = {},
    private relations: RelationMap = {},
    private queries: QueryMap = {},
    private results: ResultMap = {},
  ) {}

  upsertQuery<M extends Model>(
    modelClass: ModelClass<M>,
    options: Options,
    {
      records,
      state = 'loaded',
      page = 0,
      paging,
      error,
    }: {
      records?: RawRecord[];
      state?: Query<M>['state'];
      page?: number;
      paging?: {pageSize: number; count: number};
      error?: string;
    } = {},
  ): Repo {
    let repo: Repo = this;
    let loadedModels: M[] | undefined;

    if (records) {
      repo = this.upsert(modelClass, records);
      loadedModels = records.map(
        r => repo.getModel(modelClass, r.id as M['id'])!,
      );
    }

    const queries = {...this.queries};
    const results = {...this.results};

    const queryId = `${modelClass.name}|${hash(options)}`;
    let query = this.queries[queryId] as Query<M>;

    if (!query) {
      let models = loadedModels || [];

      if (loadedModels && paging) {
        models = [];
        models.length = paging.count;
        models.splice(
          page * paging.pageSize,
          loadedModels.length,
          ...loadedModels,
        );
      }

      query = new Query(modelClass, {
        state,
        options,
        error,
        pageSize: paging?.pageSize,
        models,
        pendingPages: state === 'getting' ? {[page]: true} : {},
      });
    } else {
      let models: (M | undefined)[] | undefined = loadedModels;

      if (loadedModels && paging) {
        models = query.models.slice();
        models.length = paging.count;
        models.splice(
          page * paging.pageSize,
          loadedModels.length,
          ...loadedModels,
        );
      }

      let pendingPages = {...query.pendingPages};

      if (state === 'getting') {
        pendingPages[page] = true;
      } else {
        delete pendingPages[page];
      }

      query = query.update({
        state,
        error,
        models,
        pendingPages,
        pageSize: paging?.pageSize,
      });
    }

    queries[queryId] = query;

    for (const model of loadedModels || []) {
      results[model.key] = results[model.key] || {};
      results[model.key][queryId] = true;
    }

    return new Repo(repo.models, repo.relations, queries, results);
  }

  // Inserts or updates the given records into the repo.
  upsert<M extends Model>(
    klass: ModelClass<M>,
    records: RawRecord | RawRecord[],
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
          record: {...model.record, ...record},
          errors,
        });
      } else {
        model = new modelClass({state, record, errors});
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

  expunge<M extends Model>(modelClass: ModelClass<M>, id: M['id']): Repo {
    const models = {...this.models};
    const relations = {...this.relations};
    const queries = {...this.queries};
    const results = {...this.results};

    const modelKey = `${modelClass.name}|${id}`;

    delete models[modelKey];

    for (const relationName in modelClass.relations) {
      delete relations[`${modelKey}|${relationName}`];
    }

    const queryKeys = results[modelKey];

    for (const queryKey in queryKeys) {
      let query = queries[queryKey];

      if (!query) continue;

      const idx = query.models.findIndex(m => m?.id === id);

      if (idx >= 0) {
        const models = query.models.slice();
        models.splice(idx, 1);
        query = query.update({models});
        queries[queryKey] = query;
      }
    }

    delete results[modelKey];

    return new Repo(models, relations, queries, results);
  }

  expungeQuery<M extends Model>(
    modelClass: ModelClass<M>,
    options: Options,
  ): Repo {
    const query = this.getQuery(modelClass, options);
    const queries = {...this.queries};

    delete queries[`${modelClass.name}|${hash(options)}`];

    let repo = new Repo(this.models, this.relations, queries, this.results);

    if (query) {
      for (const model of query.models) {
        if (!model) continue;
        repo = repo.expunge(modelClass, model.id);
      }
    }

    return repo;
  }

  getModel<M extends Model>(
    modelClass: ModelClass<M>,
    id: M['id'],
  ): M | undefined {
    return this.models[`${modelClass.name}|${id}`] as M;
  }

  getQuery<M extends Model>(
    modelClass: ModelClass<M>,
    options: Options,
  ): Query<M> | undefined {
    const queryId = `${modelClass.name}|${hash(options)}`;
    return this.queries[queryId] as Query<M>;
  }

  fetch<M extends Model>(
    modelClass: ModelClass<M>,
    id: M['id'],
    options?: Options,
  ): [Repo, MapperAction] {
    const r = this.upsert(modelClass, {id}, {state: 'fetching'});
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
    options: Options,
    paging?: {page: number; pageSize?: number},
  ): [Repo, MapperAction] {
    const r = this.upsertQuery(modelClass, options, {
      state: 'getting',
      page: paging?.page,
    });
    const action = (): Promise<MapperResult> => {
      return modelClass.mapper.query(options, paging).then(
        ({records, paging}) => ({
          type: 'query:success',
          modelClass,
          options,
          records,
          paging,
        }),
        error => ({
          type: 'query:error',
          modelClass,
          options,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    };
    return [r, action];
  }

  create<M extends Model>(model: M, options?: Options): [Repo, MapperAction] {
    const modelClass = model.ctor;

    const action = (): Promise<MapperResult> => {
      return modelClass.mapper.create(model, options).then(
        record => ({type: 'create:success', modelClass, record}),
        err => ({
          type: 'create:error',
          model: model.update({
            errors:
              err instanceof MapperError
                ? err.errors
                : {base: err instanceof Error ? err.message : String(err)},
          }),
        }),
      );
    };

    return [this, action];
  }

  update<M extends Model>(model: M, options?: Options): [Repo, MapperAction] {
    const modelClass = model.ctor;

    const r = this.upsert(modelClass, {id: model.id}, {state: 'updating'});

    const action = (): Promise<MapperResult> => {
      return modelClass.mapper.update(model, options).then(
        record => ({type: 'update:success', modelClass, record}),
        err => ({
          type: 'update:error',
          model: model.update({
            errors:
              err instanceof MapperError
                ? err.errors
                : {base: err instanceof Error ? err.message : String(err)},
          }),
        }),
      );
    };

    return [r, action];
  }

  delete<M extends Model>(model: M, options?: Options): [Repo, MapperAction] {
    const modelClass = model.ctor;

    const r = this.upsert(modelClass, {id: model.id}, {state: 'deleting'});

    const action = (): Promise<MapperResult> => {
      return modelClass.mapper.delete(model, options).then(
        record => ({
          type: 'delete:success',
          modelClass,
          record: record || {id: model.id},
        }),
        err => ({
          type: 'delete:error',
          model: model.update({
            errors:
              err instanceof MapperError
                ? err.errors
                : {base: err instanceof Error ? err.message : String(err)},
          }),
        }),
      );
    };

    return [r, action];
  }

  processMapperResult(result: MapperResult): Repo {
    switch (result.type) {
      case 'fetch:success':
        return this.upsert(result.modelClass, result.record);
      case 'fetch:error':
        return this.upsert(
          result.modelClass,
          {id: result.id},
          {errors: {base: result.error}},
        );
      case 'query:success':
        return this.upsertQuery(result.modelClass, result.options, {
          state: 'loaded',
          records: result.records,
          page: result.paging?.page,
          paging: result.paging
            ? {
                pageSize: result.paging.pageSize,
                count: result.paging.count,
              }
            : undefined,
        });
      case 'query:error':
        return this.upsertQuery(result.modelClass, result.options, {
          state: 'error',
          error: result.error,
        });
      case 'create:success':
      case 'update:success':
        return this.upsert(result.modelClass, result.record);
      case 'delete:success':
        return this.upsert(result.modelClass, result.record, {
          state: 'deleted',
        });
      case 'create:error':
        return this;
      case 'update:error':
      case 'delete:error':
        return this.upsert(result.model.ctor, result.model.record, {
          errors: result.model.errors,
        });
    }
  }
}
