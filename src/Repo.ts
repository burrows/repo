import hash from 'object-hash';
import Model, {RawRecord, Options, ModelClass, MapperError} from './Model';
import Query from './Query';

interface ModelMap {
  [key: string]: Model;
}

interface RelationMap {
  [key: string]: string[] | string | null;
}

interface QueryMap {
  [key: string]: Query<Model>;
}

interface RelationIndex {
  [modelKey: string]: {[relationKey: string]: true};
}

interface QueryIndex {
  [modelKey: string]: {[queryKey: string]: true};
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
  | {type: 'delete:success'; modelClass: ModelClass<any>; id: string | number}
  | {type: 'delete:error'; model: Model};

export type MapperAction = () => Promise<MapperResult>;

export default class Repo {
  private modelMap: ModelMap;
  private relationMap: RelationMap;
  private queryMap: QueryMap;
  private relationIndex: RelationIndex;
  private queryIndex: QueryIndex;

  constructor(opts?: {
    modelMap: ModelMap;
    relationMap: RelationMap;
    queryMap: QueryMap;
    relationIndex: RelationIndex;
    queryIndex: QueryIndex;
  }) {
    this.modelMap = opts?.modelMap || {};
    this.relationMap = opts?.relationMap || {};
    this.queryMap = opts?.queryMap || {};
    this.relationIndex = opts?.relationIndex || {};
    this.queryIndex = opts?.queryIndex || {};
  }

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
      repo = repo.upsert(modelClass, records);
      loadedModels = records.map(
        r => repo.getModel(modelClass, r.id as M['id'])!,
      );
    }

    const queryMap = {...repo.queryMap};
    const queryIndex = {...repo.queryIndex};

    const queryId = `${modelClass.name}|${hash(options)}`;
    let query = repo.queryMap[queryId] as Query<M>;

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

    queryMap[queryId] = query;

    for (const model of loadedModels || []) {
      queryIndex[model.key] = queryIndex[model.key] || {};
      queryIndex[model.key][queryId] = true;
    }

    return new Repo({
      modelMap: repo.modelMap,
      relationMap: repo.relationMap,
      relationIndex: repo.relationIndex,
      queryMap,
      queryIndex,
    });
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
    const modelMap = {...this.modelMap};
    const relationMap = {...this.relationMap};
    const relationIndex = {...this.relationIndex};
    const queryMap = {...this.queryMap};
    const dirtyModelKeys: {[key: string]: true} = {};

    const recordQueue = Array.isArray(records)
      ? records.map(r => ({modelClass: klass, record: r}))
      : [{modelClass: klass, record: records}];
    let item: typeof recordQueue[number] | undefined;

    while ((item = recordQueue.shift())) {
      const {modelClass} = item;
      let {record} = item;

      if (!isLoadable(record)) {
        throw new Error(
          `Repo#load: received ${modelClass.name} record without an id`,
        );
      }

      const modelKey = `${modelClass.name}|${record.id}`;

      // process relations
      for (const relationName in modelClass.relations) {
        if (!(relationName in record)) continue;

        const relation = modelClass.relations[relationName];
        const relationKey = `${modelKey}|${relationName}`;
        const inverseRelation = relation.inverse
          ? relation.modelClass.relations[relation.inverse]
          : undefined;

        const {[relationName]: related, ...remaining} = record;
        record = remaining;

        // clear stale inverse relations
        if (inverseRelation && relationMap[relationKey]) {
          for (const relatedKey of relationMap[relationKey]!) {
            const inverseRelationKey = `${relatedKey}|${relation.inverse}`;

            if (!relationMap[inverseRelationKey]) continue;

            delete relationIndex[relatedKey][relationKey];

            switch (inverseRelation.cardinality) {
              case 'many':
                relationMap[inverseRelationKey] = (relationMap[
                  inverseRelationKey
                ] as string[]).filter(k => k !== modelKey);
                break;
              case 'one':
                relationMap[inverseRelationKey] = null;
                break;
            }
          }
        }

        // load related records
        switch (relation.cardinality) {
          case 'many':
            {
              if (!Array.isArray(related)) {
                throw new Error(
                  `Repo#load: ${modelClass.name}(${record.id}) to-many relation \`${relationName}\` is not an array`,
                );
              }

              const relatedKeys: string[] = [];

              for (const r of related) {
                let relatedKey: string;
                let relatedRecord: RawRecord;

                if (isLoadable(r)) {
                  relatedKey = `${relation.modelClass.name}|${r.id}`;
                  relatedKeys.push(relatedKey);
                  relatedRecord = r;
                } else if (typeof r === 'number' || typeof r === 'string') {
                  relatedKey = `${relation.modelClass.name}|${r}`;
                  relatedKeys.push(relatedKey);
                  relatedRecord = {id: r};
                } else {
                  throw new Error(
                    `Repo#load: ${modelClass.name}(${record.id}) received unloadable to-many \`${relationName}\` record`,
                  );
                }

                if (inverseRelation) {
                  const inverseRelationKey = `${relatedKey}|${relation.inverse}`;

                  relationIndex[modelKey] = relationIndex[modelKey] || {};
                  relationIndex[modelKey][inverseRelationKey] = true;

                  switch (inverseRelation.cardinality) {
                    case 'many':
                      relationMap[inverseRelationKey] =
                        relationMap[inverseRelationKey] || [];
                      if (
                        !relationMap[inverseRelationKey]!.includes(modelKey)
                      ) {
                        (relationMap[inverseRelationKey] as string[]).push(
                          modelKey,
                        );
                      }
                      break;
                    case 'one':
                      relationMap[inverseRelationKey] = modelKey;
                      break;
                  }
                }

                recordQueue.push({
                  modelClass: relation.modelClass,
                  record: relatedRecord,
                });

                relationIndex[relatedKey] = relationIndex[relatedKey] || {};
                relationIndex[relatedKey][relationKey] = true;
              }

              relationMap[relationKey] = relatedKeys;
            }
            break;
          case 'one':
            {
              let relatedKey: string | null = null;
              let relatedRecord: Loadable | null = null;

              if (related === null) {
                relatedRecord = null;
              } else if (isLoadable(related)) {
                relatedKey = `${relation.modelClass.name}|${related.id}`;
                relatedRecord = related;
              } else if (
                typeof related === 'string' ||
                typeof related === 'number'
              ) {
                relatedKey = `${relation.modelClass.name}|${related}`;
                relatedRecord = {id: related};
              }

              relationMap[relationKey] = relatedKey;

              if (relatedRecord) {
                if (inverseRelation) {
                  const inverseRelationKey = `${relatedKey}|${relation.inverse}`;

                  relationIndex[modelKey] = relationIndex[modelKey] || {};
                  relationIndex[modelKey][inverseRelationKey] = true;

                  switch (inverseRelation.cardinality) {
                    case 'many':
                      relationMap[inverseRelationKey] =
                        relationMap[inverseRelationKey] || [];
                      if (
                        !relationMap[inverseRelationKey]!.includes(modelKey)
                      ) {
                        (relationMap[inverseRelationKey] as string[]).push(
                          modelKey,
                        );
                      }
                      break;
                    case 'one':
                      relationMap[inverseRelationKey] = modelKey;
                      break;
                  }
                }

                recordQueue.push({
                  modelClass: relation.modelClass,
                  record: relatedRecord,
                });

                relationIndex[relatedKey!] = relationIndex[relatedKey!] || {};
                relationIndex[relatedKey!][relationKey] = true;
              }
            }
            break;
        }
      }

      let model = modelMap[modelKey];

      if (model) {
        model = model.update({
          state,
          record: {...model.record, ...record},
          errors,
        });
      } else {
        model = new modelClass({state, record, errors});
      }

      modelMap[modelKey] = model;
      dirtyModelKeys[modelKey] = true;
    }

    const dirtyModelQueue = Object.keys(dirtyModelKeys);
    let modelKey: string | undefined;
    while ((modelKey = dirtyModelQueue.shift())) {
      dirtyModelKeys[modelKey] = true;

      for (const relationKey in relationIndex[modelKey]) {
        const relatedModelKey = relationKey
          .split('|')
          .slice(0, 2)
          .join('|');

        if (!(relatedModelKey in dirtyModelKeys)) {
          modelMap[relatedModelKey] = modelMap[relatedModelKey].update();
          dirtyModelQueue.push(relatedModelKey);
        }
      }
    }

    for (modelKey in dirtyModelKeys) {
      const model = modelMap[modelKey];

      for (const relationName in model.ctor.relations) {
        const relation = model.ctor.relations[relationName];
        const relationKey = `${modelKey}|${relationName}`;
        const value = relationMap[relationKey];

        if (value === undefined) continue;

        switch (relation.cardinality) {
          case 'many':
            model.relations[relationName] = (value as string[]).map(
              k => modelMap[k],
            );
            break;
          case 'one':
            model.relations[relationName] = value
              ? modelMap[value as string]
              : null;
            break;
        }
      }

      for (const queryKey in this.queryIndex[modelKey]) {
        let query = queryMap[queryKey];
        query = query.update({
          models: query.models.map(m => (m?.id === model!.id ? model! : m)),
        });
        queryMap[queryKey] = query;
      }
    }

    return new Repo({
      modelMap,
      relationMap,
      relationIndex,
      queryMap,
      queryIndex: this.queryIndex,
    });
  }

  // delete from modelMap
  // use upsert to remove from all relations
  // delete from relationIndex
  // remove from queries
  // delete from queryIndex
  expunge<M extends Model>(modelClass: ModelClass<M>, id: M['id']): Repo {
    const modelKey = `${modelClass.name}|${id}`;
    const model = this.modelMap[modelKey];

    if (!model) return this;

    let repo: Repo = this;

    for (const relationKey in repo.relationIndex[modelKey]) {
      const parts = relationKey.split('|');
      const relatedModelKey = `${parts[0]}|${parts[1]}`;
      const relationName = parts[2];
      const relatedModel = repo.modelMap[relatedModelKey];
      const relation = relatedModel.ctor.relations[relationName];

      switch (relation.cardinality) {
        case 'many':
          repo = repo.upsert(relatedModel.ctor, {
            id: relatedModel.id,
            [relationName]: (relatedModel.relations[relationName] as Model[])
              .filter(m => m.id !== id)
              .map(m => m.id),
          });
          break;
        case 'one':
          repo = repo.upsert(relatedModel.ctor, {
            id: relatedModel.id,
            [relationName]: null,
          });
          break;
      }
    }

    const modelMap = {...repo.modelMap};
    const relationMap = {...repo.relationMap};
    const queryMap = {...repo.queryMap};
    const queryIndex = {...repo.queryIndex};

    for (const relationName in model.relations) {
      delete relationMap[`${modelKey}|${relationName}`];
    }

    delete modelMap[modelKey];

    for (const queryKey in queryIndex[modelKey]) {
      let query = queryMap[queryKey];

      if (!query) continue;

      const idx = query.models.findIndex(m => m?.id === id);

      if (idx >= 0) {
        const models = query.models.slice();
        models.splice(idx, 1);
        query = query.update({models});
        queryMap[queryKey] = query;
      }
    }

    delete queryIndex[modelKey];

    return new Repo({
      modelMap,
      relationMap,
      relationIndex: repo.relationIndex,
      queryMap,
      queryIndex,
    });
  }

  expungeQuery<M extends Model>(
    modelClass: ModelClass<M>,
    options: Options,
  ): Repo {
    const query = this.getQuery(modelClass, options);
    const queryMap = {...this.queryMap};

    delete queryMap[`${modelClass.name}|${hash(options)}`];

    let repo = new Repo({
      modelMap: this.modelMap,
      relationMap: this.relationMap,
      relationIndex: this.relationIndex,
      queryMap,
      queryIndex: this.queryIndex,
    });

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
    return this.modelMap[`${modelClass.name}|${id}`] as M;
  }

  getQuery<M extends Model>(
    modelClass: ModelClass<M>,
    options: Options,
  ): Query<M> | undefined {
    const queryId = `${modelClass.name}|${hash(options)}`;
    return this.queryMap[queryId] as Query<M>;
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
        () => ({
          type: 'delete:success',
          modelClass,
          id: model.id,
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
        return this.expunge(result.modelClass, result.id);
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
