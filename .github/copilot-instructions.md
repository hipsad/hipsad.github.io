# Copilot Instructions for hipsad.github.io

## Repository Overview

This repository contains a Sprint Capacity Planner - a web-based tool for planning and managing sprint capacity. It is hosted on GitHub Pages at hipsad.github.io.

## Project Type

- **Type**: Static website / Web application
- **Hosting**: GitHub Pages
- **Purpose**: Sprint Capacity Planning tool

## Code Style and Conventions

### General Guidelines

- Write clean, maintainable, and well-documented code
- Follow modern web development best practices
- Ensure responsive design for mobile and desktop views
- Prioritize accessibility (WCAG guidelines)

### HTML/CSS

- Use semantic HTML5 elements
- Keep CSS organized and modular
- Use meaningful class names (consider BEM methodology)
- Ensure cross-browser compatibility

### JavaScript

- Use modern JavaScript (ES6+) features
- Write modular, reusable code
- Include comments for complex logic
- Handle errors gracefully
- Validate user inputs

## File Structure

```
.
├── .github/
│   └── copilot-instructions.md   # This file
├── README.md                      # Project documentation
└── [web application files]        # HTML, CSS, JS files for the Sprint Capacity Planner
```

## Development Guidelines

### Adding New Features

1. Ensure features align with the Sprint Capacity Planner purpose
2. Test functionality across different browsers
3. Maintain mobile responsiveness
4. Update documentation as needed

### Code Quality

- Write self-documenting code with clear variable and function names
- Add comments only when the code's intent is not obvious
- Keep functions small and focused on a single responsibility
- Avoid code duplication

### Testing

- Manually test all UI interactions
- Verify calculations and data persistence
- Test edge cases and error conditions
- Check responsive behavior on different screen sizes

## Deployment

- Changes are automatically deployed via GitHub Pages
- Ensure all commits to main branch are production-ready
- Test locally before committing

## Best Practices for Copilot

When suggesting code changes:
- Maintain consistency with existing code style
- Consider the static site nature of the project
- Ensure compatibility with GitHub Pages hosting
- Keep the user experience smooth and intuitive
- Consider performance and load times

## Sprint Capacity Planner Specifics

- Focus on features that help teams plan sprint capacity
- Consider typical agile/scrum workflows
- Support common sprint planning activities:
  - Team member availability
  - Velocity calculations
  - Story point estimations
  - Sprint commitment planning

## Security Considerations

- This is a client-side application
- Do not store sensitive data
- Be cautious with any external API integrations
- Validate and sanitize all user inputs
- Use HTTPS for any external resources

## Accessibility

- Ensure keyboard navigation works properly
- Use appropriate ARIA labels
- Maintain sufficient color contrast
- Provide alternative text for images
- Support screen readers

## Browser Support

- Target modern browsers (Chrome, Firefox, Safari, Edge)
- Ensure graceful degradation for older browsers
- Test on both desktop and mobile browsers
