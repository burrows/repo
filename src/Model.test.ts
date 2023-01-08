import {FromSchema} from 'json-schema-to-ts';

import Model from './Model';

const PostRecordSchema = {
  type: 'object',
  required: ['id', 'title', 'category'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer'},
    title: {type: 'string'},
    category: {
      type: 'string',
      default: 'general',
      enum: ['general', 'sports', 'tech'],
    },
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
    expect(p.record).toEqual({id: 0, title: '', category: 'general'});
    expect(p.relations.author).toBe(null);
    expect(p.relations.comments).toEqual([]);
  });

  it('throws an error when the given record does not match the schema', () => {
    expect(() => {
      new Post({record: {id: 1, title: 2, category: 'sports'}});
    }).toThrow(
      new Error(`Post: record failed validation: data/title must be string`),
    );

    expect(() => {
      new Post({record: {id: 1, title: 'foo', x: 'y', category: 'tech'}});
    }).toThrow(
      new Error(
        `Post: record failed validation: data must NOT have additional properties`,
      ),
    );

    expect(() => {
      new Post({record: {category: 'foo'}});
    }).toThrow(
      new Error(
        `Post: record failed validation: data/category must be equal to one of the allowed values`,
      ),
    );
  });
});

describe('Model#hasError', () => {
  it('returns true when there are errors and false otherwise', () => {
    expect(new Post({errors: {base: 'foo'}}).hasError).toBe(true);
    expect(new Post({errors: {title: 'foo', category: 'bar'}}).hasError).toBe(
      true,
    );
    expect(new Post({errors: {}}).hasError).toBe(false);
  });
});

describe('Model#errorString', () => {
  it('returns a string containing all errors', () => {
    expect(new Post({errors: {base: 'foo'}}).errorString).toBe('base: foo');
    expect(
      new Post({errors: {title: 'foo', category: 'bar'}}).errorString,
    ).toBe('title: foo, category: bar');
    expect(new Post({errors: {}}).errorString).toBe('');
  });
});

describe('Model#set', () => {
  it('sets the given attributes and marks them as dirty', () => {
    let post = new Post();

    expect(post.record.title).toBe('');
    expect(post.record.category).toBe('general');
    expect(post.isDirty).toBe(false);
    expect(post.dirty).toEqual({});

    post = post.set({title: 'xyz'});
    expect(post.record.title).toBe('xyz');
    expect(post.record.category).toBe('general');
    expect(post.isDirty).toBe(true);
    expect(post.dirty).toEqual({title: true});

    post = post.set({category: 'sports'});
    expect(post.record.title).toBe('xyz');
    expect(post.record.category).toBe('sports');
    expect(post.isDirty).toBe(true);
    expect(post.dirty).toEqual({title: true, category: true});
  });
});

describe('Model#setRelated', () => {
  it('sets the given relation and marks it as dirty', () => {
    let author = new Author();
    let comment = new Comment();
    let post = new Post();

    expect(post.relations.author).toBe(null);
    expect(post.relations.comments).toEqual([]);
    expect(post.dirtyRelations).toEqual({});
    expect(post.isDirty).toBe(false);

    post = post.setRelated('author', author);
    expect(post.relations.author).toBe(author);
    expect(post.relations.comments).toEqual([]);
    expect(post.dirtyRelations).toEqual({author: true});
    expect(post.isDirty).toBe(true);

    post = post.setRelated('comments', [comment]);
    expect(post.relations.author).toBe(author);
    expect(post.relations.comments).toEqual([comment]);
    expect(post.dirtyRelations).toEqual({author: true, comments: true});
    expect(post.isDirty).toBe(true);
  });
});
