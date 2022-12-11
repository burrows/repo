import {FromSchema} from 'json-schema-to-ts';

import Model from './Model';

const PostAttributesSchema = {
  type: 'object',
  required: ['id', 'title'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer'},
    title: {type: 'string'},
  },
} as const;

class Post extends Model<FromSchema<typeof PostAttributesSchema>> {
  static schema = PostAttributesSchema;

  static get relations() {
    return {
      author: {
        cardinality: 'one' as const,
        modelClass: Author,
      },
      comments: {
        cardinality: 'many' as const,
        modelClass: Comment,
      },
    };
  }
}
class Comment extends Model {}
class Author extends Model {}

describe('Model constructor', () => {
  it('defaults to new state, default attributes and empty relations', () => {
    const p = new Post();
    expect(p.state).toBe('new');
    expect(p.attributes).toEqual({id: 0, title: ''});
    expect(p.relations.author).toBe(null);
    expect(p.relations.comments).toEqual([]);
  });

  it(`throws an error when the given attributes don't match the schema`, () => {
    expect(() => {
      new Post({attributes: {}});
    }).toThrow(
      new Error(
        `Post: attributes failed validation: data must have required property 'id', data must have required property 'title'`,
      ),
    );

    expect(() => {
      new Post({attributes: {id: 1, title: 2}});
    }).toThrow(
      new Error(
        `Post: attributes failed validation: data/title must be string`,
      ),
    );

    expect(() => {
      new Post({attributes: {id: 1, title: 'foo', x: 'y'}});
    }).toThrow(
      new Error(
        `Post: attributes failed validation: data must NOT have additional properties`,
      ),
    );
  });
});
