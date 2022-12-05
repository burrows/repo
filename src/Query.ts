import Model, {ModelClass} from './Model';

export type QueryState = 'new' | 'getting' | 'loaded' | 'error';

export default class Query<M extends Model> {
  public modelClass: ModelClass<M>;
  public state: QueryState;
  public options: Record<string, unknown>;
  public pageSize?: number;
  public models: (M | undefined)[];

  constructor(
    modelClass: ModelClass<M>,
    {
      state = 'new',
      options = {},
      pageSize,
      models = [],
    }: {
      state?: QueryState;
      options?: Record<string, unknown>;
      pageSize?: number;
      models?: (M | undefined)[];
    },
  ) {
    this.modelClass = modelClass;
    this.state = state;
    this.options = options;
    this.pageSize = pageSize;
    this.models = models;
  }

  update({
    state,
    models,
  }: {
    state?: QueryState;
    models?: (M | undefined)[];
  }): Query<M> {
    return new Query(this.modelClass, {
      options: this.options,
      state: state || this.state,
      models: models || this.models,
    });
  }
}
