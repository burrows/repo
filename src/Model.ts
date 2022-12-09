export interface Mapper {
  fetch(
    id: number | string,
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export const NullMapper: Mapper = {
  fetch(
    _id: number | string,
    _options: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    throw new Error(
      'Mapper.get not defined: set the static mapper property on your model to an object that implements the Mapper interface',
    );
  },
};

export type ModelState = 'new' | 'fetching' | 'loaded';
// | 'getting'
// | 'creating'
// | 'updating'
// | 'destroying'
// | 'destroyed'

interface BaseAttributes {
  id: string | number;
}

interface Relations {
  [name: string]: Model[] | Model | null;
}

export interface Errors {
  [attribute: string]: string;
}

interface ModelNewOpts {
  state?: ModelState;
  attributes?: Record<string, unknown>;
  errors?: Errors;
  relations?: Relations;
}

export interface ModelClass<M> extends Function {
  new (opts: ModelNewOpts): M;
  relations: {
    [name: string]: {
      cardinality: 'many' | 'one';
      modelClass: ModelClass<any>;
      inverse?: string;
    };
  };
  mapper: Mapper;
}

export default class Model<A extends BaseAttributes = {id: number}> {
  static relations: ModelClass<Model>['relations'] = {};
  static mapper: Mapper = NullMapper;

  state: ModelState;
  attributes: A;
  relations: Relations;
  errors: Errors;

  constructor({
    state = 'new',
    attributes = {},
    errors = {},
    relations,
  }: ModelNewOpts = {}) {
    this.state = state;
    this.attributes = attributes as A; // FIXME: validate attributes
    this.errors = errors;
    this.relations = relations || this.defaultRelations();
  }

  get ctor(): ModelClass<this> {
    return this.constructor as ModelClass<this>;
  }

  get id(): A['id'] {
    return this.attributes.id;
  }

  get name(): string {
    return this.ctor.name;
  }

  get key(): string {
    return `${this.name}|${this.id}`;
  }

  set(attributes: Partial<A>): this {
    return this.update({attributes: {...this.attributes, ...attributes}});
  }

  update({
    state = this.state,
    attributes = this.attributes as Record<string, unknown>,
    errors = this.errors,
    relations = this.relations,
  }: ModelNewOpts = {}): this {
    return new this.ctor({state, attributes, errors, relations});
  }

  private defaultRelations(): Relations {
    const relations: Relations = {};

    for (const relationName in this.ctor.relations) {
      switch (this.ctor.relations[relationName].cardinality) {
        case 'many':
          relations[relationName] = [];
          break;
        case 'one':
          relations[relationName] = null;
          break;
      }
    }

    return relations;
  }
}
