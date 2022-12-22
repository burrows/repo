import {FromSchema} from 'json-schema-to-ts';

import Model from './Model';

const PostRecordSchema = {
  type: 'object',
  required: ['id', 'title'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer'},
    title: {type: 'string'},
  },
} as const;

class Post extends Model<FromSchema<typeof PostRecordSchema>> {
  static schema = PostRecordSchema;

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
  it('defaults to new state, default record and empty relations', () => {
    const p = new Post();
    expect(p.state).toBe('new');
    expect(p.record).toEqual({id: 0, title: ''});
    expect(p.relations.author).toBe(null);
    expect(p.relations.comments).toEqual([]);
  });

  it(`throws an error when the given record don't match the schema`, () => {
    expect(() => {
      new Post({record: {}});
    }).toThrow(
      new Error(
        `Post: record failed validation: data must have required property 'id', data must have required property 'title'`,
      ),
    );

    expect(() => {
      new Post({record: {id: 1, title: 2}});
    }).toThrow(
      new Error(`Post: record failed validation: data/title must be string`),
    );

    expect(() => {
      new Post({record: {id: 1, title: 'foo', x: 'y'}});
    }).toThrow(
      new Error(
        `Post: record failed validation: data must NOT have additional properties`,
      ),
    );
  });
});
