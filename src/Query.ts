import Model, {Options, ModelClass} from './Model';

export type QueryState = 'new' | 'getting' | 'loaded' | 'error';

export default class Query<M extends Model> {
  public modelClass: ModelClass<M>;
  public state: QueryState;
  public options: Options;
  public error?: string;
  public pageSize?: number;
  public models: (M | undefined)[];

  constructor(
    modelClass: ModelClass<M>,
    {
      state = 'new',
      options = {},
      error,
      pageSize,
      models = [],
    }: {
      state?: QueryState;
      options?: Options;
      error?: string;
      pageSize?: number;
      models?: (M | undefined)[];
    },
  ) {
    this.modelClass = modelClass;
    this.state = state;
    this.options = options;
    this.error = error;
    this.pageSize = pageSize;
    this.models = models;
  }

  update({
    state,
    models,
    error,
  }: {
    state?: QueryState;
    models?: (M | undefined)[];
    error?: string;
  }): Query<M> {
    return new Query(this.modelClass, {
      options: this.options,
      state: state || this.state,
      models: models || this.models,
      error: error || this.error,
    });
  }
}
