const gulp = require('gulp');
const path = require('path');

function copyIcons() {
	return gulp.src('nodes/**/*.{svg,png,jpg,jpeg,gif}')
		.pipe(gulp.dest('dist/nodes'));
}

exports['build:icons'] = copyIcons;

