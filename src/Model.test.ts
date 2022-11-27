import Model from './Model';

describe('Model constructor', () => {
  class Post extends Model {
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

  it('defaults to new state, empty attributes and relations', () => {
    const p = new Post();
    expect(p.state).toBe('new');
    expect(p.attributes).toEqual({});
    expect(p.relations.author).toBe(null);
    expect(p.relations.comments).toEqual([]);
  });
});
