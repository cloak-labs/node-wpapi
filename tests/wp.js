'use strict';
var expect = require( 'chai' ).expect;

var WP = require( '../' );

describe( 'wp', function() {

	describe( 'constructor', function() {

		it( 'enforces new', function() {
			var wp1 = new WP({ endpoint: '/' });
			expect( wp1 instanceof WP ).to.be.true;
			var wp2 = WP({ endpoint: '/' });
			expect( wp2 instanceof WP ).to.be.true;
		});

		it( 'throws an error if no endpoint is provided', function() {
			expect(function() {
				new WP({ endpoint: '/' });
			}).not.to.throw();
			expect(function() {
				new WP();
			}).to.throw();
		});

		it( 'sets options on an instance variable', function() {
			var wp = new WP({
				endpoint: 'http://some.url.com/wp-json',
				username: 'fyodor',
				password: 'dostoyevsky'
			});
			expect( wp._options.endpoint ).to.equal( 'http://some.url.com/wp-json/' );
			expect( wp._options.username ).to.equal( 'fyodor' );
			expect( wp._options.password ).to.equal( 'dostoyevsky' );
		});

	});

	describe( '.site()', function() {

		it( 'Creates and returns a new WP instance', function() {
			var site = WP.site( 'endpoint/url' );
			expect( site instanceof WP ).to.be.true;
			expect( site._options.endpoint ).to.equal( 'endpoint/url/' );
		});

	});

	describe( 'endpoint accessors', function() {

		var site;

		beforeEach(function() {
			site = new WP({ endpoint: 'endpoint/url' });
		});

		it( 'defines a posts endpoint handler', function() {
			var posts = site.posts();
			expect( posts instanceof require('../lib/posts' ) ).to.be.true;
		});

		it( 'defines a taxonomies endpoint handler', function() {
			var posts = site.taxonomies();
			expect( posts instanceof require('../lib/taxonomies' ) ).to.be.true;
		});

		it( 'defines a types endpoint handler', function() {
			var posts = site.types();
			expect( posts instanceof require('../lib/types' ) ).to.be.true;
		});

		it( 'defines a users endpoint handler', function() {
			var posts = site.users();
			expect( posts instanceof require('../lib/users' ) ).to.be.true;
		});

	});

});