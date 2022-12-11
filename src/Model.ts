import Ajv, {Schema} from 'ajv';
import ajvFormats from 'ajv-formats';

const ajv = new Ajv({allErrors: true});
ajvFormats(ajv);

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
  validate?: boolean;
}

type ModelUpdateOpts = Omit<ModelNewOpts, 'validate'>;

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
  schema: Schema;
}

const defaultAttributes = (schema: any): any => {
  if (!schema) return {};

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return defaultAttributes(schema.oneOf[0]);
  }

  if (schema?.type !== 'object') {
    throw new Error(
      `Model.defaultAttributes: can't generate attributes from schema`,
    );
  }

  const a: any = {};

  for (const k of schema.required || []) {
    let type = schema?.properties[k]?.type;

    if (!type) continue;

    if (Array.isArray(type)) {
      type = type[0];
    }

    if (!type) continue;

    switch (type) {
      case 'number':
      case 'integer':
        a[k] = 0;
        break;
      case 'string':
        a[k] = schema.properties[k].enum ? schema.properties[k].enum[0] : '';
        break;
      case 'boolean':
        a[k] = false;
        break;
      case 'array':
        a[k] = [];
        break;
      case 'object':
        a[k] = defaultAttributes(schema.properties[k]);
        break;
      case 'null':
        a[k] = null;
        break;
    }
  }

  return a;
};

export default class Model<A extends BaseAttributes = {id: number}> {
  static relations: ModelClass<Model>['relations'] = {};
  static mapper: Mapper = NullMapper;
  static schema: Schema = {type: 'object'};

  state: ModelState;
  attributes: A;
  relations: Relations;
  errors: Errors;

  constructor({
    state = 'new',
    attributes,
    errors = {},
    relations,
    validate = true,
  }: ModelNewOpts = {}) {
    const attrs = (attributes || defaultAttributes(this.ctor.schema)) as A;

    if (validate) {
      const validator = ajv.compile(this.ctor.schema);
      if (!validator(attrs)) {
        const msg = `${
          this.name
        }: attributes failed validation: ${ajv.errorsText(validator.errors)}`;
        throw new Error(msg);
      }
    }

    this.state = state;
    this.attributes = attrs;
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
    attributes,
    errors = this.errors,
    relations = this.relations,
  }: ModelUpdateOpts = {}): this {
    return new this.ctor({
      state,
      attributes: (attributes || this.attributes) as Record<string, unknown>,
      errors,
      relations,
      validate: attributes !== this.attributes,
    });
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
